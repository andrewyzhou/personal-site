// public leak audit: pure checks over what the site serves (serializer output,
// served json, the kv copy). used by scripts/audit-public-leaks.mts, which does
// all the io and is always read-only.
//   leak    → something private is (or could be) public: exit non-zero
//   warning → worth a look (near a zone edge, metadata without gps, …)

import exifr from "exifr";
import { decodeMultiPolyline } from "../polyline";
import { ZONE_EDGE_BUFFER_M, distanceToPolygonEdgeM, pointInPolygon, segmentTouchesPolygon, type ZoneInput } from "./fog";

export type Severity = "leak" | "warning";

export interface Finding {
  severity: Severity;
  where: string; // e.g. "activity 12 polyline", "/api/activities/12"
  message: string;
}

// keys that must never appear in anything public, at any depth
export const PRIVATE_KEYS = [
  "trackBbox",
  "track_bbox",
  "fitBlobUrl",
  "fit_blob_url",
  "fitBlobPathname",
  "fit_blob_pathname",
  "fitSha256",
  "fit_sha256",
  "takenAt",
  "taken_at",
  "gpsLat",
  "gps_lat",
  "gpsLng",
  "gps_lng",
  "canonicalTrackKey",
  "canonical_track_key",
  "publishedInputsHash",
  "published_inputs_hash",
  "dedupeKey",
  "dedupe_key",
  "externalId",
  "external_id",
  "source",
  "startDateUtc",
  "start_date_utc",
  "originalSha256",
  "original_sha256",
  "blobPathname",
  "blob_pathname",
] as const;

const PRIVATE_KEY_SET = new Set<string>(PRIVATE_KEYS);

// every private key path in a json value ("photos[0].gpsLat")
export function findPrivateKeys(value: unknown, path = ""): string[] {
  const out: string[] = [];
  if (Array.isArray(value)) {
    value.forEach((v, i) => out.push(...findPrivateKeys(v, `${path}[${i}]`)));
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      const p = path ? `${path}.${k}` : k;
      if (PRIVATE_KEY_SET.has(k)) out.push(p);
      out.push(...findPrivateKeys(v, p));
    }
  }
  return out;
}

export interface PointTally {
  inside: number; // strictly inside (or on the edge of) a zone
  near: number; // outside, but within the edge buffer
  zoneIds: Set<number>;
  minEdgeM: number; // closest approach to any zone edge among near points
}

function emptyTally(): PointTally {
  return { inside: 0, near: 0, zoneIds: new Set(), minEdgeM: Infinity };
}

export function tallyPoint(t: PointTally, lat: number, lng: number, zones: ZoneInput[], bufferM = ZONE_EDGE_BUFFER_M): void {
  for (const z of zones) {
    if (pointInPolygon(lat, lng, z.polygon)) {
      t.inside++;
      t.zoneIds.add(z.id);
      return;
    }
  }
  for (const z of zones) {
    const d = distanceToPolygonEdgeM(lat, lng, z.polygon);
    if (d <= bufferM) {
      t.near++;
      t.zoneIds.add(z.id);
      if (d < t.minEdgeM) t.minEdgeM = d;
      return;
    }
  }
}

function tallyFindings(t: PointTally, where: string, what: string): Finding[] {
  const zones = [...t.zoneIds].sort((a, b) => a - b).join(",");
  const out: Finding[] = [];
  if (t.inside) out.push({ severity: "leak", where, message: `${t.inside} ${what} inside zone(s) ${zones}` });
  if (t.near) {
    out.push({
      severity: "warning",
      where,
      message: `${t.near} ${what} within ${ZONE_EDGE_BUFFER_M} m of zone(s) ${zones} (closest ${t.minEdgeM.toFixed(1)} m)`,
    });
  }
  return out;
}

const isLatLng = (p: unknown): p is [number, number] =>
  Array.isArray(p) && p.length >= 2 && typeof p[0] === "number" && typeof p[1] === "number" &&
  Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180;

export function checkPoints(points: [number, number][], zones: ZoneInput[], where: string, what = "point(s)"): Finding[] {
  if (zones.length === 0) return [];
  const t = emptyTally();
  for (const [lat, lng] of points) tallyPoint(t, lat, lng, zones);
  return tallyFindings(t, where, what);
}

// a (multi-segment) encoded polyline: every point of every segment
export function checkPolyline(encoded: unknown, zones: ZoneInput[], where: string): Finding[] {
  if (encoded === null || encoded === undefined) return [];
  if (typeof encoded !== "string") return [{ severity: "leak", where, message: "polyline is not a string" }];
  let segments: [number, number][][];
  try {
    segments = decodeMultiPolyline(encoded);
  } catch {
    return [{ severity: "warning", where, message: "polyline does not decode" }];
  }
  const points = segments.flat();
  const bad = points.filter((p) => !isLatLng(p)).length;
  const out: Finding[] = bad ? [{ severity: "warning", where, message: `${bad} decoded point(s) out of range` }] : [];
  return [...out, ...checkPoints(points.filter(isLatLng), zones, where), ...checkChords(segments, zones, where)];
}

// a map draws a straight line between consecutive points of a segment (never
// across a segment break): any such line touching a zone shows its inside
export function checkChords(segments: [number, number][][], zones: ZoneInput[], where: string): Finding[] {
  if (zones.length === 0) return [];
  let crossing = 0;
  const ids = new Set<number>();
  for (const seg of segments) {
    for (let i = 1; i < seg.length; i++) {
      const a = seg[i - 1], b = seg[i];
      if (!isLatLng(a) || !isLatLng(b)) continue;
      const hit = zones.filter((z) => segmentTouchesPolygon(a, b, z.polygon));
      if (hit.length === 0) continue;
      crossing++;
      for (const z of hit) ids.add(z.id);
    }
  }
  if (!crossing) return [];
  const list = [...ids].sort((x, y) => x - y).join(",");
  return [{ severity: "leak", where, message: `${crossing} drawn line(s) between points touch zone(s) ${list}` }];
}

export function checkBounds(bounds: unknown, zones: ZoneInput[], where: string): Finding[] {
  if (bounds === null || bounds === undefined) return [];
  const b = bounds as Record<string, unknown>;
  const nums = ["minLat", "minLng", "maxLat", "maxLng"].map((k) => b[k]);
  if (!nums.every((n) => typeof n === "number" && Number.isFinite(n))) {
    return [{ severity: "warning", where, message: "bounds are malformed" }];
  }
  const [minLat, minLng, maxLat, maxLng] = nums as number[];
  return checkPoints(
    [[minLat, minLng], [minLat, maxLng], [maxLat, minLng], [maxLat, maxLng]],
    zones,
    where,
    "bounds corner(s)"
  );
}

// zone shapes are never published: any served fog shape (even an empty list)
// outlines a private place
export function checkFogShapes(shapes: unknown, where: string): Finding[] {
  if (shapes === null || shapes === undefined) return [];
  const n = Array.isArray(shapes) ? shapes.length : 1;
  return [{ severity: "leak", where, message: `zone shapes are published (${n}); fog shapes must be null` }];
}

// fog events are published only as an aggregate: an entry/exit point marks the
// zone edge, so one is worth a look even when it sits outside every zone
export function checkFogEvents(events: unknown, zones: ZoneInput[], where: string): Finding[] {
  if (!Array.isArray(events)) return [];
  const edge: [number, number][] = [];
  let withPoints = 0;
  for (const e of events as { entry?: unknown; exit?: unknown }[]) {
    const pts = [e?.entry, e?.exit].filter((p) => p !== null && p !== undefined);
    if (pts.length) withPoints++;
    for (const p of pts) if (isLatLng(p)) edge.push([p[0], p[1]]);
  }
  const out: Finding[] = withPoints
    ? [{ severity: "warning", where, message: `${withPoints} fog event(s) carry entry/exit points` }]
    : [];
  return [...out, ...checkPoints(edge, zones, where, "fog edge point(s)")];
}

export interface PublicActivityLike {
  id?: unknown;
  polyline?: unknown;
  cardPolyline?: unknown;
  bounds?: unknown;
  fogEvents?: unknown;
  fogShapes?: unknown;
  photos?: unknown;
}

// everything location-ish in one served activity object (detail or list item)
export function checkPublicActivity(a: PublicActivityLike, zones: ZoneInput[], where: string): Finding[] {
  const out: Finding[] = [];
  for (const k of findPrivateKeys(a)) out.push({ severity: "leak", where, message: `private key "${k}" is served` });
  out.push(...checkPolyline(a.polyline, zones, `${where} polyline`));
  out.push(...checkPolyline(a.cardPolyline, zones, `${where} cardPolyline`));
  out.push(...checkBounds(a.bounds, zones, `${where} bounds`));
  out.push(...checkFogShapes(a.fogShapes, `${where} fogShapes`));
  out.push(...checkFogEvents(a.fogEvents, zones, `${where} fogEvents`));
  if (Array.isArray(a.photos)) {
    const pins: [number, number][] = [];
    for (const p of a.photos as { pin?: unknown }[]) if (isLatLng(p?.pin)) pins.push([p.pin[0], p.pin[1]]);
    out.push(...checkPoints(pins, zones, `${where} photo pins`, "photo pin(s)"));
  }
  return out;
}

// what the visibility switches promise, checked on a served object
export function checkVisibility(
  a: Record<string, unknown>,
  vis: { mapHidden: boolean; hrHidden: boolean },
  where: string
): Finding[] {
  const out: Finding[] = [];
  if (vis.mapHidden) {
    for (const k of ["polyline", "cardPolyline", "bounds", "fogShapes", "fogEvents"]) {
      if (a[k] !== null && a[k] !== undefined) out.push({ severity: "leak", where, message: `map hidden but "${k}" is served` });
    }
    if (Array.isArray(a.photos) && (a.photos as { pin?: unknown }[]).some((p) => p?.pin)) {
      out.push({ severity: "leak", where, message: "map hidden but photo pins are served" });
    }
  }
  if (vis.hrHidden) {
    for (const k of ["averageHeartrate", "maxHeartrate", "sufferScore"]) {
      if (a[k] !== null && a[k] !== undefined) out.push({ severity: "leak", where, message: `hr hidden but "${k}" is served` });
    }
  }
  return out;
}

// what exifr found in a served photo (merged parse output, or undefined)
export function checkPhotoMetadata(meta: Record<string, unknown> | undefined | null, where: string): Finding[] {
  if (!meta || Object.keys(meta).length === 0) return [];
  const keys = Object.keys(meta);
  const gps =
    (typeof meta.latitude === "number" && typeof meta.longitude === "number") ||
    keys.some((k) => /^GPS/i.test(k));
  if (gps) return [{ severity: "leak", where, message: "photo carries gps metadata" }];
  const when = ["DateTimeOriginal", "CreateDate", "DateTimeDigitized", "ModifyDate"].filter((k) => k in meta);
  return [
    {
      severity: "warning",
      where,
      message: `photo carries metadata (${keys.length} tag(s)${when.length ? `, incl. ${when.join("/")}` : ""})`,
    },
  ];
}

// container format by magic bytes (for the audit's coverage line)
export function imageFormat(bytes: Uint8Array): string {
  const ascii = (o: number, n: number) => String.fromCharCode(...bytes.subarray(o, o + n));
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "jpeg";
  if (bytes[0] === 0x89 && ascii(1, 3) === "PNG") return "png";
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") return "webp";
  if (ascii(4, 4) === "ftyp") {
    const brand = ascii(8, 4);
    return brand.startsWith("avi") ? "avif" : brand.startsWith("hei") || brand.startsWith("mif") ? "heic" : `isobmff:${brand}`;
  }
  return "unknown";
}

// webp isn't parsed by exifr: find the riff chunks, so EXIF / XMP payloads can
// be flagged (and the EXIF one handed to exifr as a tiff block)
export function webpChunks(bytes: Uint8Array): { fourcc: string; data: Uint8Array }[] {
  const ascii = (o: number, n: number) => String.fromCharCode(...bytes.subarray(o, o + n));
  if (bytes.length < 12 || ascii(0, 4) !== "RIFF" || ascii(8, 4) !== "WEBP") return [];
  const out: { fourcc: string; data: Uint8Array }[] = [];
  let o = 12;
  while (o + 8 <= bytes.length) {
    const fourcc = ascii(o, 4);
    const size = bytes[o + 4] | (bytes[o + 5] << 8) | (bytes[o + 6] << 16) | (bytes[o + 7] << 24);
    if (size < 0 || o + 8 + size > bytes.length) break;
    out.push({ fourcc, data: bytes.subarray(o + 8, o + 8 + size) });
    o += 8 + size + (size % 2);
  }
  return out;
}

const EXIFR_OPTIONS = { tiff: true, exif: true, gps: true, xmp: true, iptc: true, icc: false, mergeOutput: true, translateValues: false };

// every metadata tag exifr can find in a served image (null: none). exifr
// doesn't read webp, so its EXIF chunk is parsed as the tiff block it is and
// an XMP chunk is flagged (gps if it names gps coordinates).
export async function photoMetadata(bytes: Uint8Array): Promise<Record<string, unknown> | null> {
  const chunks = webpChunks(bytes);
  if (chunks.length) {
    const out: Record<string, unknown> = {};
    for (const c of chunks) {
      if (c.fourcc === "EXIF") {
        // optional "Exif\0\0" prefix before the tiff header
        const data = String.fromCharCode(...c.data.subarray(0, 4)) === "Exif" ? c.data.subarray(6) : c.data;
        const parsed = await exifr.parse(Buffer.from(data), EXIFR_OPTIONS).catch(() => null);
        Object.assign(out, parsed && Object.keys(parsed).length ? parsed : { EXIF: "unparsed" });
      } else if (c.fourcc === "XMP ") {
        out.XMP = true;
        if (/GPS(Latitude|Longitude)/i.test(new TextDecoder().decode(c.data))) out.GPSLatitude = "xmp";
      }
    }
    return Object.keys(out).length ? out : null;
  }
  const parsed = await exifr.parse(Buffer.from(bytes), EXIFR_OPTIONS);
  return parsed && Object.keys(parsed).length ? parsed : null;
}

// originals (fit/gpx/tcx) still sitting in the public bucket
export function checkPublicOriginals(keys: { key: string; size: number }[], where: string): Finding[] {
  if (keys.length === 0) return [];
  const bytes = keys.reduce((n, k) => n + k.size, 0);
  return [
    {
      severity: "warning",
      where,
      message: `${keys.length} original file(s) (${(bytes / 1e6).toFixed(1)} MB) still in the public bucket — deleting them is the owner's call`,
    },
  ];
}

export function summarize(findings: Finding[]): { leaks: number; warnings: number } {
  return {
    leaks: findings.filter((f) => f.severity === "leak").length,
    warnings: findings.filter((f) => f.severity === "warning").length,
  };
}
