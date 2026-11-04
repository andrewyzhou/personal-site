import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { parseTrackFile, type ParsedTrackFile } from "@/lib/fit";
import { dedupeKey, findByDedupeKey, localDateTime, computePublished } from "@/lib/activities";
import { storeOriginal, type StoredOriginal } from "@/lib/activity-sources";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_MULTIPART_BYTES = 4 * 1024 * 1024; // vercel request cap is 4.5mb

// preview track for the trim ui: uniform stride sample keeping per-point extras
// aligned — [lat, lng, cumDistM, tOffsetS, eleM|null, hr|null]
type PreviewPoint = [number, number, number, number, number | null, number | null];

function previewTrack(parsed: ParsedTrackFile, maxPoints = 2000): PreviewPoint[] | null {
  const pts: PreviewPoint[] = [];
  for (let i = 0; i < parsed.records.length; i++) {
    const r = parsed.records[i];
    if (r.lat !== null && r.lng !== null) {
      pts.push([r.lat, r.lng, parsed.cumDist[i], r.t, r.ele, r.hr]);
    }
  }
  if (pts.length < 2) return null;
  if (pts.length <= maxPoints) return pts;
  const stride = pts.length / maxPoints;
  const out: PreviewPoint[] = [];
  for (let i = 0; i < maxPoints - 1; i++) {
    out.push(pts[Math.floor(i * stride)]);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

export async function POST(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const started = Date.now();
  try {
    let bytes: Uint8Array;
    let filename: string;

    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json({ ok: false, error: "no file in request" }, { status: 400 });
      }
      if (file.size > MAX_MULTIPART_BYTES) {
        return NextResponse.json(
          { ok: false, error: "file too large for direct upload" },
          { status: 413 }
        );
      }
      bytes = new Uint8Array(await file.arrayBuffer());
      filename = file.name;
    } else {
      return NextResponse.json({ ok: false, error: "expected multipart/form-data" }, { status: 400 });
    }

    let parsed: ParsedTrackFile;
    try {
      parsed = parseTrackFile(bytes, filename);
    } catch (error) {
      log.warn("admin:parse", "decode failed", error);
      return NextResponse.json(
        { ok: false, error: `could not parse that file — ${(error as Error).message}` },
        { status: 422 }
      );
    }

    // originals are retained no matter what happens next; content addressing
    // makes re-parse and re-upload idempotent
    let stored: StoredOriginal;
    try {
      stored = await storeOriginal(bytes, filename, parsed.startDateUtc, { provider: "upload", filename });
    } catch (error) {
      log.error("admin:parse", "original write failed", error);
      return NextResponse.json({ ok: false, error: "storage write failed" }, { status: 502 });
    }

    const preTrimElapsed =
      parsed.sessionStats?.elapsedTimeS ??
      (parsed.records.length > 0 ? Math.round(parsed.records[parsed.records.length - 1].t) : 0);
    const duplicate = await findByDedupeKey(
      dedupeKey(parsed.startDateUtc.getTime() / 1000, preTrimElapsed)
    );

    const zero = computePublished(parsed, 0, 0);
    const { localDate, localTime } = localDateTime(parsed.startDateUtc, parsed.utcOffsetMin);

    log.info(
      "admin:parse",
      `parsed ${parsed.fileType} ${bytes.length}b in ${Date.now() - started}ms (${parsed.records.length} records)`
    );

    return NextResponse.json({
      ok: true,
      draft: {
        rawSha256: stored.rawSha256,
        // legacy public copy, only before the private store exists
        fitBlobUrl: stored.legacy?.url ?? null,
        fitBlobPathname: stored.legacy?.pathname ?? null,
        fitSha256: stored.legacy?.sha256 ?? null,
        fileType: parsed.fileType,
        sportType: parsed.sportType,
        suggestedName: parsed.suggestedName,
        startDateUtc: parsed.startDateUtc.toISOString(),
        localDate,
        localTime,
        utcOffsetMin: parsed.utcOffsetMin,
        hasLocalTime: parsed.hasLocalTime,
        stats: zero.stats,
        kilojoules: parsed.kilojoules,
        track: previewTrack(parsed),
        duplicate: duplicate
          ? { id: duplicate.id, name: duplicate.name, date: duplicate.localDate }
          : null,
      },
    });
  } catch (error) {
    log.error("admin:parse", "unexpected failure", error);
    return NextResponse.json({ ok: false, error: "parse failed" }, { status: 500 });
  }
}
