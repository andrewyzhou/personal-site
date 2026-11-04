import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin-auth";
import { parseTrackFile } from "@/lib/fit";
import {
  buildActivityValues,
  computePublished,
  insertActivity,
  sha256Hex,
} from "@/lib/activities";
import { addActivityEdit, addActivitySource } from "@/lib/activity-sources";
import { getRawStore, isRawStoreConfigured, isSha256 } from "@/lib/raw-store";
import { republish } from "@/lib/republish";
import { getDb, activityPhotos } from "@/lib/db";
import { invalidateCache } from "@/lib/cache";
import { r2Get, r2PublicUrl } from "@/lib/r2";
import { parsePhotoList, type PhotoInput } from "@/app/api/admin/photos/photo-input";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface PublishBody {
  rawSha256?: string;
  fitBlobPathname?: string; // legacy public copy (pre-cutover drafts)
  name?: string;
  description?: string | null;
  sportType?: string;
  gear?: string | null;
  trimStartM?: number;
  trimEndM?: number;
  utcOffsetMinFallback?: number;
  // private fields (originalSha256, takenAt, gpsLat/gpsLng) ride along per photo
  photos?: unknown;
}

// the stored original: private raw store by sha when it exists, else the
// legacy public path from the draft
async function loadOriginal(body: PublishBody): Promise<
  | { bytes: Uint8Array; filename: string; rawSha256: string; legacyPathname: string | null }
  | { error: string; status: number }
> {
  if (typeof body.rawSha256 === "string" && isSha256(body.rawSha256) && isRawStoreConfigured()) {
    const store = getRawStore();
    try {
      const bytes = await store.get(body.rawSha256);
      const manifest = await store.manifestRow(body.rawSha256).catch(() => null);
      return {
        bytes,
        filename: manifest?.originalFilename || `${body.rawSha256}.fit`,
        rawSha256: body.rawSha256,
        legacyPathname: null,
      };
    } catch (error) {
      log.error("admin:publish", "could not re-read original from the raw store", error);
      return { error: "could not re-read original file", status: 502 };
    }
  }
  if (typeof body.fitBlobPathname === "string" && body.fitBlobPathname.startsWith("activities/fit/")) {
    try {
      const bytes = await r2Get(body.fitBlobPathname);
      return { bytes, filename: body.fitBlobPathname, rawSha256: sha256Hex(bytes), legacyPathname: body.fitBlobPathname };
    } catch (error) {
      log.error("admin:publish", "could not re-read original from storage", error);
      return { error: "could not re-read original file", status: 502 };
    }
  }
  return { error: "rawSha256 or fitBlobPathname is required", status: 400 };
}

// publish. stateless and authoritative: the server re-reads the original,
// records it as the activity's source plus the trim as an edit, and republish
// computes every published stat — the client's preview numbers are never trusted.
export async function POST(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  let body: PublishBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }

  if (!body.rawSha256 && (!body.fitBlobPathname || typeof body.fitBlobPathname !== "string")) {
    return NextResponse.json({ ok: false, error: "rawSha256 or fitBlobPathname is required" }, { status: 400 });
  }
  if (!body.name || typeof body.name !== "string") {
    return NextResponse.json({ ok: false, error: "name is required" }, { status: 400 });
  }
  let photos: PhotoInput[] = [];
  if (body.photos !== undefined && body.photos !== null) {
    const parsedPhotos = parsePhotoList(body.photos);
    if ("error" in parsedPhotos) return NextResponse.json({ ok: false, error: parsedPhotos.error }, { status: 400 });
    photos = parsedPhotos.photos;
  }

  try {
    const original = await loadOriginal(body);
    if ("error" in original) {
      return NextResponse.json({ ok: false, error: original.error }, { status: original.status });
    }

    const trimStartM = Math.max(0, Number(body.trimStartM) || 0);
    const trimEndM = Math.max(0, Number(body.trimEndM) || 0);
    const parsed = parseTrackFile(original.bytes, original.filename);
    const published = computePublished(parsed, trimStartM, trimEndM);
    const legacy = original.legacyPathname;

    const values = buildActivityValues(parsed, published, {
      name: body.name.trim(),
      description: body.description?.trim() || null,
      sportType: body.sportType,
      gear: body.gear?.trim() || null,
      source: "upload",
      // legacy public copy only; the raw store is reached through the source row
      fitBlobUrl: legacy ? r2PublicUrl(legacy) : null,
      fitBlobPathname: legacy,
      fitSha256: legacy ? original.rawSha256 : null,
      utcOffsetMinFallback: body.utcOffsetMinFallback,
    });

    const outcome = await insertActivity(values);
    if (!outcome.inserted) {
      return NextResponse.json(
        { ok: false, error: "duplicate activity", id: outcome.id },
        { status: 409 }
      );
    }

    await addActivitySource({
      activityId: outcome.id,
      provider: "upload",
      kind: "device-file",
      rawSha256: original.rawSha256,
    });
    // always recorded, even 0/0, so the default privacy trim never applies to an upload
    await addActivityEdit(outcome.id, "trim", { startM: trimStartM, endM: trimEndM });
    // photos before republish: their pins are computed from the private exif
    if (photos.length > 0) {
      try {
        await getDb()
          .insert(activityPhotos)
          .values(
            photos.map((p, i) => ({
              activityId: outcome.id,
              blobUrl: p.url,
              blobPathname: p.pathname,
              width: p.width,
              height: p.height,
              position: i,
              caption: p.caption,
              originalSha256: p.originalSha256 ?? null,
              takenAt: p.takenAt ?? null,
              gpsLat: p.gps?.lat ?? null,
              gpsLng: p.gps?.lng ?? null,
            }))
          );
      } catch (error) {
        // recoverable via PATCH; the activity itself is safely published
        log.error("admin:publish", `photo insert failed for activity ${outcome.id}`, error);
      }
    }

    let status = "not-run";
    try {
      status = (await republish(outcome.id)).status;
    } catch (error) {
      // the inserted row already carries the same trim's stats; a later rebuild catches up
      log.error("admin:publish", `republish failed for activity ${outcome.id}`, error);
    }

    await invalidateCache("activities_list", "activities_latest");
    revalidatePath(`/activities/${outcome.id}`);
    log.info(
      "admin:publish",
      `published ${outcome.id} (${values.sportType}, trim ${trimStartM}/${trimEndM}, republish ${status})`
    );

    return NextResponse.json({ ok: true, id: outcome.id, url: `/activities/${outcome.id}` }, { status: 201 });
  } catch (error) {
    log.error("admin:publish", "publish failed", error);
    return NextResponse.json({ ok: false, error: "publish failed" }, { status: 500 });
  }
}
