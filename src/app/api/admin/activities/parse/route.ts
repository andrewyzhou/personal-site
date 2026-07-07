import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { parseTrackFile, unwrapTrackFile, type ParsedTrackFile } from "@/lib/fit";
import {
  dedupeKey,
  findByDedupeKey,
  fitBlobPathname,
  localDateTime,
  sha256Hex,
  computePublished,
} from "@/lib/activities";
import { r2Put } from "@/lib/r2";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_MULTIPART_BYTES = 4 * 1024 * 1024; // vercel request cap is 4.5mb

const CONTENT_TYPES: Record<string, string> = {
  fit: "application/octet-stream",
  gpx: "application/gpx+xml",
  tcx: "application/xml",
};

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
    let inner: { bytes: Uint8Array; fileType: string };
    try {
      // unwrap once for content-addressed storage of the inner track bytes
      inner = unwrapTrackFile(bytes, filename);
      parsed = parseTrackFile(bytes, filename);
    } catch (error) {
      log.warn("admin:parse", "decode failed", error);
      return NextResponse.json(
        { ok: false, error: `could not parse that file — ${(error as Error).message}` },
        { status: 422 }
      );
    }

    // originals are retained no matter what happens next; content-addressed path
    // makes re-parse and re-upload idempotent
    const sha = sha256Hex(inner.bytes);
    const pathname = fitBlobPathname(sha, parsed.fileType, parsed.startDateUtc);
    let fitBlobUrl: string;
    try {
      const put = await r2Put(pathname, inner.bytes, CONTENT_TYPES[parsed.fileType]);
      fitBlobUrl = put.url;
    } catch (error) {
      log.error("admin:parse", "r2 write failed", error);
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
        fitBlobUrl,
        fitBlobPathname: pathname,
        fitSha256: sha,
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
