import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/admin-auth";
import { addActivityEdit, revertActivityEdit } from "@/lib/activity-sources";
import { republish } from "@/lib/republish";
import { getDb, activities, activityPhotos } from "@/lib/db";
import { invalidateCache } from "@/lib/cache";
import { r2Delete } from "@/lib/r2";
import { visibilityColumns, type Visibility } from "@/lib/public-activity";
import { staleMark } from "@/lib/privacy/stale";
import { parsePhotoList, type PhotoInput } from "@/app/api/admin/photos/photo-input";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface PatchBody {
  name?: string;
  description?: string | null;
  sportType?: string;
  gear?: string | null;
  hidden?: boolean; // legacy switch; visibility wins when both are sent
  visibility?: unknown; // public | hide-map | private
  hrHidden?: unknown;
  trimStartM?: number;
  trimEndM?: number;
  // private fields (originalSha256, takenAt, gpsLat/gpsLng) ride along per photo;
  // omitted ones are kept from the photo with the same pathname
  photos?: unknown;
}

const VISIBILITIES: readonly Visibility[] = ["public", "hide-map", "private"];

async function loadRow(id: number) {
  const rows = await getDb().select().from(activities).where(eq(activities.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ ok: false, error: "bad id" }, { status: 400 });
  }

  let body: PatchBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }

  if (body.visibility !== undefined && !VISIBILITIES.includes(body.visibility as Visibility)) {
    return NextResponse.json({ ok: false, error: "visibility must be public, hide-map or private" }, { status: 400 });
  }
  if (body.hrHidden !== undefined && typeof body.hrHidden !== "boolean") {
    return NextResponse.json({ ok: false, error: "hrHidden must be a boolean" }, { status: 400 });
  }
  let photos: PhotoInput[] | null = null;
  if (body.photos !== undefined && body.photos !== null) {
    const parsedPhotos = parsePhotoList(body.photos);
    if ("error" in parsedPhotos) return NextResponse.json({ ok: false, error: parsedPhotos.error }, { status: 400 });
    photos = parsedPhotos.photos;
  }

  try {
    const row = await loadRow(id);
    if (!row) {
      return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (typeof body.name === "string" && body.name.trim()) updates.name = body.name.trim();
    if (body.description !== undefined) updates.description = body.description?.trim() || null;
    // cleaned stats and detection depend on the sport: a change needs a rebuild
    const sportChanged = typeof body.sportType === "string" && !!body.sportType && body.sportType !== row.sportType;
    if (typeof body.sportType === "string" && body.sportType) updates.sportType = body.sportType;
    if (sportChanged) Object.assign(updates, staleMark());
    if (body.gear !== undefined) updates.gear = body.gear?.trim() || null;
    if (typeof body.hidden === "boolean") updates.hidden = body.hidden;
    // visibility is plain columns the public serializer applies; nothing to rebuild
    if (body.visibility !== undefined) Object.assign(updates, visibilityColumns(body.visibility as Visibility));
    if (typeof body.hrHidden === "boolean") updates.hrHidden = body.hrHidden;

    // a trim change is a recorded edit; republish rebuilds the published columns
    // from the stored track. nothing to rebuild from → the edit is reverted.
    const trimChanged =
      (body.trimStartM !== undefined && body.trimStartM !== row.trimStartM) ||
      (body.trimEndM !== undefined && body.trimEndM !== row.trimEndM);
    if (trimChanged) {
      const editId = await addActivityEdit(id, "trim", {
        startM: Math.max(0, Number(body.trimStartM ?? row.trimStartM) || 0),
        endM: Math.max(0, Number(body.trimEndM ?? row.trimEndM) || 0),
      });
      const result = await republish(id).catch(async (error) => {
        // never leave an edit active that the published columns don't reflect
        await revertActivityEdit(editId);
        throw error;
      });
      if (result.status === "no-source" || result.status === "not-found") {
        await revertActivityEdit(editId);
        return NextResponse.json(
          { ok: false, error: "no original file stored — trim is not editable" },
          { status: 422 }
        );
      }
      if (result.status === "source-unavailable") {
        await revertActivityEdit(editId);
        return NextResponse.json(
          { ok: false, error: "original file is unreadable right now — trim not applied" },
          { status: 503 }
        );
      }
    }

    const db = getDb();
    await db.update(activities).set(updates).where(eq(activities.id, id));

    // photo list replacement (rows only; blobs are removed by hard delete)
    let pinStatus: string | null = null;
    // stale is already marked, so a failure here is retried by the rebuild job
    let sportStatus: string | null = null;
    if (sportChanged && !photos) {
      try {
        sportStatus = (await republish(id)).status;
      } catch (error) {
        sportStatus = "failed";
        log.error("admin:edit", `republish after sport change failed for ${id}`, error);
      }
    }
    if (photos) {
      // the private fields (original link, capture time, precise gps) of a photo
      // already on the activity survive the row replacement unless new ones are sent
      const previous = await db
        .select({
          pathname: activityPhotos.blobPathname,
          width: activityPhotos.width,
          height: activityPhotos.height,
          originalSha256: activityPhotos.originalSha256,
          takenAt: activityPhotos.takenAt,
          gpsLat: activityPhotos.gpsLat,
          gpsLng: activityPhotos.gpsLng,
          pinLat: activityPhotos.pinLat,
          pinLng: activityPhotos.pinLng,
        })
        .from(activityPhotos)
        .where(eq(activityPhotos.activityId, id));
      const byPath = new Map(previous.map((p) => [p.pathname, p]));
      const rows = photos.map((p, i) => {
        const prev = byPath.get(p.pathname);
        const takenAt = p.takenAt ?? prev?.takenAt ?? null;
        const gpsLat = p.gps ? p.gps.lat : (prev?.gpsLat ?? null);
        const gpsLng = p.gps ? p.gps.lng : (prev?.gpsLng ?? null);
        // the old pin stays only while its inputs are unchanged (republish below refreshes it)
        const samePlace =
          !!prev && prev.gpsLat === gpsLat && prev.gpsLng === gpsLng &&
          (prev.takenAt?.getTime() ?? null) === (takenAt?.getTime() ?? null);
        return {
          activityId: id,
          blobUrl: p.url,
          blobPathname: p.pathname,
          width: p.width ?? prev?.width ?? null,
          height: p.height ?? prev?.height ?? null,
          position: i,
          caption: p.caption,
          originalSha256: p.originalSha256 ?? prev?.originalSha256 ?? null,
          takenAt,
          gpsLat,
          gpsLng,
          pinLat: samePlace ? prev.pinLat : null,
          pinLng: samePlace ? prev.pinLng : null,
        };
      });
      await db.delete(activityPhotos).where(eq(activityPhotos.activityId, id));
      if (rows.length > 0) await db.insert(activityPhotos).values(rows);

      // pins come from republish; the edit itself is already saved, so a failure
      // here only leaves pins stale until the next rebuild
      try {
        pinStatus = (await republish(id)).status;
      } catch (error) {
        pinStatus = "failed";
        log.error("admin:edit", `republish after photo change failed for ${id}`, error);
      }
    }

    await invalidateCache("activities_list", "activities_latest");
    revalidatePath(`/activities/${id}`);
    log.info(
      "admin:edit",
      `patched activity ${id}${trimChanged ? " (trim recomputed)" : ""}${sportStatus ? ` (sport, republish ${sportStatus})` : ""}${pinStatus ? ` (photos, republish ${pinStatus})` : ""}`
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    log.error("admin:edit", `patch failed for ${id}`, error);
    return NextResponse.json({ ok: false, error: "edit failed" }, { status: 500 });
  }
}

// soft by default: hides, never destroys. ?hard=true removes the row + photo
// blobs (the fit original is always kept).
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ ok: false, error: "bad id" }, { status: 400 });
  }

  try {
    const db = getDb();
    const row = await loadRow(id);
    if (!row) {
      return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    }

    const hard = new URL(request.url).searchParams.get("hard") === "true";
    if (hard) {
      const photos = await db
        .select({ pathname: activityPhotos.blobPathname })
        .from(activityPhotos)
        .where(eq(activityPhotos.activityId, id));
      await db.delete(activities).where(eq(activities.id, id)); // cascades photo rows
      for (const p of photos) {
        try {
          await r2Delete(p.pathname);
        } catch (error) {
          log.warn("admin:edit", `photo blob delete failed: ${p.pathname}`, error);
        }
      }
      log.info("admin:edit", `hard-deleted activity ${id} (${photos.length} photo blobs)`);
    } else {
      await db.update(activities).set({ hidden: true, updatedAt: new Date() }).where(eq(activities.id, id));
      log.info("admin:edit", `soft-hid activity ${id}`);
    }

    await invalidateCache("activities_list", "activities_latest");
    revalidatePath(`/activities/${id}`);
    return NextResponse.json({ ok: true });
  } catch (error) {
    log.error("admin:edit", `delete failed for ${id}`, error);
    return NextResponse.json({ ok: false, error: "delete failed" }, { status: 500 });
  }
}
