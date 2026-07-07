import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin-auth";
import { parseTrackFile } from "@/lib/fit";
import {
  buildActivityValues,
  computePublished,
  insertActivity,
} from "@/lib/activities";
import { getDb, activityPhotos } from "@/lib/db";
import { invalidateCache } from "@/lib/cache";
import { r2Get, r2PublicUrl } from "@/lib/r2";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface PublishBody {
  fitBlobPathname?: string;
  name?: string;
  description?: string | null;
  sportType?: string;
  gear?: string | null;
  trimStartM?: number;
  trimEndM?: number;
  utcOffsetMinFallback?: number;
  photos?: { pathname: string; url: string; width?: number; height?: number; caption?: string | null }[];
}

// publish. stateless and authoritative: the server re-fetches the original from
// r2, re-parses, applies the trim itself, and recomputes all published stats —
// the client's preview numbers are never trusted.
export async function POST(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  let body: PublishBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }

  if (!body.fitBlobPathname || typeof body.fitBlobPathname !== "string") {
    return NextResponse.json({ ok: false, error: "fitBlobPathname is required" }, { status: 400 });
  }
  if (!body.name || typeof body.name !== "string") {
    return NextResponse.json({ ok: false, error: "name is required" }, { status: 400 });
  }

  try {
    let bytes: Uint8Array;
    try {
      bytes = await r2Get(body.fitBlobPathname);
    } catch (error) {
      log.error("admin:publish", "could not re-read original from storage", error);
      return NextResponse.json(
        { ok: false, error: "could not re-read original file" },
        { status: 502 }
      );
    }

    const parsed = parseTrackFile(bytes, body.fitBlobPathname);
    const published = computePublished(parsed, body.trimStartM ?? 0, body.trimEndM ?? 0);
    const sha = body.fitBlobPathname.split("/").pop()?.split(".")[0] ?? null;

    const values = buildActivityValues(parsed, published, {
      name: body.name.trim(),
      description: body.description?.trim() || null,
      sportType: body.sportType,
      gear: body.gear?.trim() || null,
      source: "upload",
      fitBlobUrl: r2PublicUrl(body.fitBlobPathname),
      fitBlobPathname: body.fitBlobPathname,
      fitSha256: sha,
      utcOffsetMinFallback: body.utcOffsetMinFallback,
    });

    const outcome = await insertActivity(values);
    if (!outcome.inserted) {
      return NextResponse.json(
        { ok: false, error: "duplicate activity", id: outcome.id },
        { status: 409 }
      );
    }

    if (body.photos && body.photos.length > 0) {
      try {
        await getDb()
          .insert(activityPhotos)
          .values(
            body.photos.map((p, i) => ({
              activityId: outcome.id,
              blobUrl: p.url,
              blobPathname: p.pathname,
              width: p.width ?? null,
              height: p.height ?? null,
              position: i,
              caption: p.caption ?? null,
            }))
          );
      } catch (error) {
        // recoverable via PATCH; the activity itself is safely published
        log.error("admin:publish", `photo insert failed for activity ${outcome.id}`, error);
      }
    }

    await invalidateCache("activities_list", "activities_latest");
    revalidatePath(`/activities/${outcome.id}`);
    log.info(
      "admin:publish",
      `published ${outcome.id} (${values.sportType}, ${Math.round(values.distanceM ?? 0)}m, trim ${values.trimStartM}/${values.trimEndM})`
    );

    return NextResponse.json({ ok: true, id: outcome.id, url: `/activities/${outcome.id}` }, { status: 201 });
  } catch (error) {
    log.error("admin:publish", "publish failed", error);
    return NextResponse.json({ ok: false, error: "publish failed" }, { status: 500 });
  }
}
