// canonical track: one normalized, versioned, columnar per-second track per
// activity, built deterministically from the best raw source available.
// stored gzipped in the private raw bucket under derived/ (never public).
//
// normalization (format v1): timestamps snapped to whole seconds, samples
// sorted by time, at most one sample per second (the last one wins). values are
// otherwise kept exactly as the source reported them; gaps (pauses) stay gaps.
//
// source precedence: device file (fit/gpx/tcx) > strava streams > strava polyline.

import { gzipSync, gunzipSync, strToU8, strFromU8 } from "fflate";
import { parseTrackFile, type ParsedTrackFile, type TrackFileType } from "./fit";
import { cumulativeDistances, type ComputedStats, type TrackRecord } from "./geo";
import { decodePolyline } from "./polyline";
import { sha256Hex, DERIVED_KEY_PREFIX } from "./raw-store";

export const CANONICAL_FORMAT_VERSION = 1;

export type TrackSourceKind = "device-file" | "strava-streams" | "strava-polyline";

// lower index wins
export const TRACK_SOURCE_PRECEDENCE: readonly TrackSourceKind[] = [
  "device-file",
  "strava-streams",
  "strava-polyline",
];

export interface CanonicalColumns {
  t: number[]; // whole seconds since the first sample (≈ startEpochMs)
  lat: (number | null)[];
  lng: (number | null)[];
  ele: (number | null)[];
  hr: (number | null)[];
  cadence: (number | null)[];
  watts: (number | null)[];
  speed: (number | null)[];
  dist: number[]; // cumulative metres (device channel when present, else haversine)
}

export interface CanonicalTrack {
  format: "canonical-track";
  v: typeof CANONICAL_FORMAT_VERSION;
  source: {
    kind: TrackSourceKind;
    sha256: string; // raw object the track was built from
    detailSha256?: string | null; // strava detail json used alongside streams/polyline
    fileType: TrackFileType | null;
  };
  sportType: string;
  startEpochMs: number;
  utcOffsetMin: number;
  hasLocalTime: boolean;
  syntheticTime: boolean; // polyline-only: t is spread evenly, not measured
  session: ComputedStats | null; // device/provider totals, used verbatim at zero trim
  kilojoules: number | null;
  suggestedName: string;
  columns: CanonicalColumns;
}

// ---------------------------------------------------------------------------
// normalization

interface Sample {
  rec: TrackRecord;
  dist: number;
}

function toColumns(samples: Sample[]): CanonicalColumns {
  const c: CanonicalColumns = { t: [], lat: [], lng: [], ele: [], hr: [], cadence: [], watts: [], speed: [], dist: [] };
  for (const { rec, dist } of samples) {
    c.t.push(rec.t);
    c.lat.push(rec.lat);
    c.lng.push(rec.lng);
    c.ele.push(rec.ele);
    c.hr.push(rec.hr);
    c.cadence.push(rec.cadence);
    c.watts.push(rec.watts);
    c.speed.push(rec.speed);
    c.dist.push(dist);
  }
  return c;
}

const finiteOrNull = (v: number | null | undefined): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

// snap to whole seconds, stable-sort by time, keep the last sample per second
export function normalizeSamples(records: TrackRecord[], cumDist: number[]): CanonicalColumns {
  const snapped: (Sample & { i: number })[] = [];
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    if (!Number.isFinite(r.t)) continue;
    const lat = finiteOrNull(r.lat);
    const lng = finiteOrNull(r.lng);
    const hasPos = lat !== null && lng !== null;
    snapped.push({
      i,
      rec: {
        t: Math.round(r.t),
        lat: hasPos ? lat : null,
        lng: hasPos ? lng : null,
        ele: finiteOrNull(r.ele),
        hr: finiteOrNull(r.hr),
        cadence: finiteOrNull(r.cadence),
        watts: finiteOrNull(r.watts),
        speed: finiteOrNull(r.speed),
      },
      dist: Number.isFinite(cumDist[i]) ? cumDist[i] : NaN,
    });
  }
  snapped.sort((a, b) => a.rec.t - b.rec.t || a.i - b.i);
  const out: Sample[] = [];
  for (const s of snapped) {
    const last = out[out.length - 1];
    if (last && last.rec.t === s.rec.t) out[out.length - 1] = s;
    else out.push(s);
  }
  // shift so the first sample is t=0 (start time absorbs the offset)
  const t0 = out.length > 0 ? out[0].rec.t : 0;
  for (const s of out) s.rec.t -= t0;
  // distance: keep the provided channel when complete and monotonic, else haversine
  const provided = out.map((s) => s.dist);
  const monotonic = provided.every((d, i) => Number.isFinite(d) && (i === 0 || d >= provided[i - 1]));
  const dist = monotonic && out.length > 0 ? provided : cumulativeDistances(out.map((s) => s.rec));
  return toColumns(out.map((s, i) => ({ rec: s.rec, dist: dist[i] })));
}

// ---------------------------------------------------------------------------
// builders

export function canonicalFromParsed(
  parsed: ParsedTrackFile,
  source: { kind: TrackSourceKind; sha256: string; detailSha256?: string | null },
  opts: { syntheticTime?: boolean } = {}
): CanonicalTrack {
  const columns = opts.syntheticTime
    ? toColumns(parsed.records.map((rec, i) => ({ rec, dist: parsed.cumDist[i] })))
    : normalizeSamples(parsed.records, parsed.cumDist);
  return {
    format: "canonical-track",
    v: CANONICAL_FORMAT_VERSION,
    source: {
      kind: source.kind,
      sha256: source.sha256,
      detailSha256: source.detailSha256 ?? null,
      fileType: source.kind === "device-file" ? parsed.fileType : null,
    },
    sportType: parsed.sportType,
    // the source's own start (fit session start / first gpx point / strava
    // start_date), kept verbatim so dedupe keys and local dates never drift
    startEpochMs: parsed.startDateUtc.getTime(),
    utcOffsetMin: parsed.utcOffsetMin,
    hasLocalTime: parsed.hasLocalTime,
    syntheticTime: Boolean(opts.syntheticTime),
    session: parsed.sessionStats,
    kilojoules: parsed.kilojoules,
    suggestedName: parsed.suggestedName,
    columns,
  };
}

// device file (fit/gpx/tcx, optionally zip/gzip wrapped): the exact raw bytes
export function canonicalFromDeviceFile(bytes: Uint8Array, filename: string, sha256 = sha256Hex(bytes)): CanonicalTrack {
  return canonicalFromParsed(parseTrackFile(bytes, filename), { kind: "device-file", sha256 });
}

// strava DetailedActivity fields the builders read
export interface StravaDetailLike {
  id: number;
  name?: string;
  sport_type?: string;
  type?: string;
  start_date: string;
  utc_offset?: number; // seconds
  distance?: number;
  moving_time?: number;
  elapsed_time?: number;
  total_elevation_gain?: number;
  average_speed?: number;
  max_speed?: number;
  has_heartrate?: boolean;
  average_heartrate?: number;
  max_heartrate?: number;
  average_cadence?: number;
  average_watts?: number;
  max_watts?: number;
  kilojoules?: number;
  map?: { polyline?: string | null; summary_polyline?: string | null } | null;
}

export function stravaSummaryStats(d: StravaDetailLike): ComputedStats {
  return {
    distanceM: d.distance || 0,
    movingTimeS: d.moving_time || 0,
    elapsedTimeS: d.elapsed_time || 0,
    elevGainM: d.total_elevation_gain || 0,
    avgSpeedMs: d.average_speed || 0,
    maxSpeedMs: d.max_speed || 0,
    avgHr: d.has_heartrate ? d.average_heartrate ?? null : null,
    maxHr: d.has_heartrate ? d.max_heartrate ?? null : null,
    avgCadence: d.average_cadence ?? null,
    avgWatts: d.average_watts ?? null,
    maxWatts: d.max_watts ?? null,
  };
}

const STREAM_KEYS = ["time", "latlng", "altitude", "distance", "heartrate", "cadence", "watts", "velocity_smooth"] as const;
type StreamKey = (typeof STREAM_KEYS)[number];
type StreamMap = Partial<Record<StreamKey, unknown[]>>;

// accepts both key_by_type=true ({time: {data}}) and the array form ([{type, data}])
export function normalizeStravaStreams(raw: unknown): StreamMap {
  const out: StreamMap = {};
  if (Array.isArray(raw)) {
    for (const s of raw as { type?: string; data?: unknown[] }[]) {
      if (s && typeof s.type === "string" && Array.isArray(s.data) && (STREAM_KEYS as readonly string[]).includes(s.type)) {
        out[s.type as StreamKey] = s.data;
      }
    }
  } else if (raw && typeof raw === "object") {
    for (const k of STREAM_KEYS) {
      const s = (raw as Record<string, { data?: unknown[] } | undefined>)[k];
      if (s && Array.isArray(s.data)) out[k] = s.data;
    }
  }
  return out;
}

function stravaParsedBase(detail: StravaDetailLike, records: TrackRecord[], cumDist: number[]): ParsedTrackFile {
  return {
    fileType: "fit", // placeholder: api tracks have no file; source.fileType is null
    sportType: detail.sport_type || detail.type || "Workout",
    startDateUtc: new Date(detail.start_date),
    utcOffsetMin: Math.round((detail.utc_offset ?? 0) / 60),
    hasLocalTime: detail.utc_offset !== undefined,
    records,
    cumDist,
    sessionStats: stravaSummaryStats(detail),
    kilojoules: detail.kilojoules ?? null,
    suggestedName: detail.name || "workout",
  };
}

// streams json + detail json (both raw bytes as returned by the api)
export function canonicalFromStravaStreams(
  detail: StravaDetailLike,
  streamsRaw: unknown,
  shas: { streamsSha256: string; detailSha256: string }
): CanonicalTrack | null {
  const s = normalizeStravaStreams(streamsRaw);
  const time = s.time as number[] | undefined;
  if (!time || time.length < 2) return null;
  const latlng = s.latlng as [number, number][] | undefined;
  const at = (k: StreamKey, i: number): number | null => {
    const v = s[k]?.[i];
    return typeof v === "number" ? v : null;
  };
  const records: TrackRecord[] = time.map((t, i) => ({
    lat: latlng?.[i]?.[0] ?? null,
    lng: latlng?.[i]?.[1] ?? null,
    t,
    ele: at("altitude", i),
    hr: at("heartrate", i),
    cadence: at("cadence", i),
    watts: at("watts", i),
    speed: at("velocity_smooth", i),
  }));
  const distance = s.distance as number[] | undefined;
  const cumDist = distance && distance.length === records.length ? distance : cumulativeDistances(records);
  return canonicalFromParsed(stravaParsedBase(detail, records, cumDist), {
    kind: "strava-streams",
    sha256: shas.streamsSha256,
    detailSha256: shas.detailSha256,
  });
}

// last resort: the detail's polyline (full when present, else summary). no
// timestamps exist, so t is spread evenly over elapsed time and flagged synthetic.
export function canonicalFromStravaPolyline(detail: StravaDetailLike, detailSha256: string): CanonicalTrack | null {
  const encoded = detail.map?.polyline || detail.map?.summary_polyline;
  if (!encoded) return null;
  const points = decodePolyline(encoded);
  if (points.length < 2) return null;
  const elapsed = detail.elapsed_time || 0;
  const records: TrackRecord[] = points.map(([lat, lng], i) => ({
    lat,
    lng,
    t: points.length > 1 ? (elapsed * i) / (points.length - 1) : 0,
    ele: null,
    hr: null,
    cadence: null,
    watts: null,
    speed: null,
  }));
  return canonicalFromParsed(
    stravaParsedBase(detail, records, cumulativeDistances(records)),
    { kind: "strava-polyline", sha256: detailSha256, detailSha256 },
    { syntheticTime: true }
  );
}

// ---------------------------------------------------------------------------
// back to the shape the publish math (computePublished) consumes

export function canonicalToParsed(track: CanonicalTrack): ParsedTrackFile {
  const c = track.columns;
  const records: TrackRecord[] = c.t.map((t, i) => ({
    t,
    lat: c.lat[i],
    lng: c.lng[i],
    ele: c.ele[i],
    hr: c.hr[i],
    cadence: c.cadence[i],
    watts: c.watts[i],
    speed: c.speed[i],
  }));
  return {
    fileType: track.source.fileType ?? "fit",
    sportType: track.sportType,
    startDateUtc: new Date(track.startEpochMs),
    utcOffsetMin: track.utcOffsetMin,
    hasLocalTime: track.hasLocalTime,
    records,
    cumDist: c.dist.slice(),
    sessionStats: track.session,
    kilojoules: track.kilojoules,
    suggestedName: track.suggestedName,
  };
}

export function hasGps(track: CanonicalTrack): boolean {
  let n = 0;
  for (let i = 0; i < track.columns.lat.length; i++) {
    if (track.columns.lat[i] !== null && track.columns.lng[i] !== null && ++n >= 2) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// serialization: deterministic bytes (fixed key order from the builders, gzip
// mtime pinned to 0) so the content-addressed key is stable across rebuilds

export function serializeCanonical(track: CanonicalTrack): Uint8Array {
  return gzipSync(strToU8(JSON.stringify(track)), { level: 9, mtime: 0 });
}

export function deserializeCanonical(bytes: Uint8Array): CanonicalTrack {
  const parsed = JSON.parse(strFromU8(gunzipSync(bytes))) as CanonicalTrack;
  if (parsed.format !== "canonical-track") throw new Error("not a canonical track");
  if (parsed.v !== CANONICAL_FORMAT_VERSION) throw new Error(`unsupported canonical track version ${parsed.v}`);
  return parsed;
}

export function canonicalTrackKey(serialized: Uint8Array): string {
  return `${DERIVED_KEY_PREFIX}canonical/v${CANONICAL_FORMAT_VERSION}/${sha256Hex(serialized)}.json.gz`;
}
