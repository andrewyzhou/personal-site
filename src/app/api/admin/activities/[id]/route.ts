import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/admin-auth";
import { parseTrackFile } from "@/lib/fit";
import { buildActivityValues, computePublished } from "@/lib/activities";
import { getDb, activities, activityPhotos } from "@/lib/db";
import { invalidateCache } from "@/lib/cache";
import { r2Delete, r2Get } from "@/lib/r2";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface PatchBody {
  name?: string;
  description?: string | null;
  sportType?: string;
  gear?: string | null;
  hidden?: boolean;
  trimStartM?: number;
  trimEndM?: number;
  photos?: { pathname: string; url: string; width?: number; height?: number; caption?: string | null }[];
}

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

  try {
    const row = await loadRow(id);
    if (!row) {
      return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (typeof body.name === "string" && body.name.trim()) updates.name = body.name.trim();
    if (body.description !== undefined) updates.description = body.description?.trim() || null;
    if (typeof body.sportType === "string" && body.sportType) updates.sportType = body.sportType;
    if (body.gear !== undefined) updates.gear = body.gear?.trim() || null;
    if (typeof body.hidden === "boolean") updates.hidden = body.hidden;

    // trim changes re-run the same computation path as publish, from the original
    const trimChanged =
      (body.trimStartM !== undefined && body.trimStartM !== row.trimStartM) ||
      (body.trimEndM !== undefined && body.trimEndM !== row.trimEndM);
    if (trimChanged) {
      if (!row.fitBlobPathname) {
        return NextResponse.json(
          { ok: false, error: "no original file stored — trim is not editable" },
          { status: 422 }
        );
      }
      const bytes = await r2Get(row.fitBlobPathname);
      const parsed = parseTrackFile(bytes, row.fitBlobPathname);
      const published = computePublished(
        parsed,
        body.trimStartM ?? row.trimStartM,
        body.trimEndM ?? row.trimEndM
      );
      const recomputed = buildActivityValues(parsed, published, {
        name: (updates.name as string) ?? row.name,
        utcOffsetMinFallback: row.utcOffsetMin,
      });
      updates.distanceM = recomputed.distanceM;
      updates.movingTimeS = recomputed.movingTimeS;
      updates.elapsedTimeS = recomputed.elapsedTimeS;
      updates.elevGainM = recomputed.elevGainM;
      updates.avgSpeedMs = recomputed.avgSpeedMs;
      updates.maxSpeedMs = recomputed.maxSpeedMs;
      updates.avgHr = recomputed.avgHr;
      updates.maxHr = recomputed.maxHr;
      updates.avgCadence = recomputed.avgCadence;
      updates.avgWatts = recomputed.avgWatts;
      updates.maxWatts = recomputed.maxWatts;
      updates.polyline = recomputed.polyline;
      updates.cardPolyline = recomputed.cardPolyline;
      updates.bounds = recomputed.bounds;
      updates.trimStartM = recomputed.trimStartM;
      updates.trimEndM = recomputed.trimEndM;
    }

    const db = getDb();
    await db.update(activities).set(updates).where(eq(activities.id, id));

    // photo list replacement (rows only; blobs are removed by hard delete)
    if (body.photos) {
      await db.delete(activityPhotos).where(eq(activityPhotos.activityId, id));
      if (body.photos.length > 0) {
        await db.insert(activityPhotos).values(
          body.photos.map((p, i) => ({
            activityId: id,
            blobUrl: p.url,
            blobPathname: p.pathname,
            width: p.width ?? null,
            height: p.height ?? null,
            position: i,
            caption: p.caption ?? null,
          }))
        );
      }
    }

    await invalidateCache("activities_list", "activities_latest");
    revalidatePath(`/activities/${id}`);
    log.info("admin:edit", `patched activity ${id}${trimChanged ? " (trim recomputed)" : ""}`);
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
