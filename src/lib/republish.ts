// republish(activityId): the only writer of an activity's published route/stat
// columns. deterministic from (canonical track, active edits, privacy zones,
// privacy settings, photos, processing version); the inputs hash makes
// staleness checks cheap and lets bulk rebuilds skip anything already current.
// raw inputs are never touched.
//
// pipeline: trim (trim edit, else the settings default for gps tracks) → fog
// (zones: in-zone points dropped, route broken at zones, fog events) → stats
// (+ distance policy when fogged) → overrides → polylines/bounds from visible
// points only → photo pins → coarsened published start. identity/metadata
// columns (name, sport, raw start/local time, hidden) are not written here.
// visibility (hide map / hide hr) is applied by the public serializer.
// server-only.

import { createHash } from "crypto";
import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import {
  getDb,
  activities,
  activitySources,
  activityEdits,
  activityPhotos,
  privacyZones,
  type ActivityRow,
  type FogEvent,
  type PrivacySettings,
  type RouteBounds,
  type ActivitySettings,
  type RawStats,
  activitySuggestions,
} from "./db";
import {
  CARD_POLYLINE_MAX_POINTS,
  DEFAULT_PRIVACY_TRIM_M,
  DETAIL_POLYLINE_MAX_POINTS,
  localDateTime,
} from "./activities";
import { boundsOf, computeStats, haversineM, rdpReduce, trimByDistance } from "./geo";
import { decodeMultiPolyline, encodeMultiPolyline } from "./polyline";
import {
  applyFog,
  segmentTouchesPolygon,
  relevantZones,
  zonesContaining,
  type FogSample,
  type ZoneInput,
} from "./privacy/fog";
import {
  DEFAULT_PRIVACY_SETTINGS,
  coarsenStart,
  loadPrivacySettings,
  publishedDistance,
} from "./privacy/settings";
import { CLEANING_EDIT_KINDS, applyCleaning, effectiveCropWindow, mergeTargets, type MergedPart } from "./cleaning/edits";
import { isKnownSport } from "./cleaning/sport";
import { cleanedStats, hrZoneSeconds, rawStatsOf } from "./cleaning/stats";
import { DEFAULT_ACTIVITY_SETTINGS, loadActivitySettings } from "./cleaning/settings";
import { detectSuggestions } from "./cleaning/detect";
import { DETECTOR_VERSION, type Suggestion } from "./cleaning/types";
import {
  CANONICAL_FORMAT_VERSION,
  TRACK_SOURCE_PRECEDENCE,
  canonicalFromDeviceFile,
  canonicalFromStravaPolyline,
  canonicalFromStravaStreams,
  canonicalToParsed,
  canonicalTrackKey,
  hasGps,
  serializeCanonical,
  type CanonicalTrack,
  type StravaDetailLike,
  type TrackSourceKind,
} from "./canonical-track";
import { getRawStore, isRawStoreConfigured, sha256Hex } from "./raw-store";
import { r2Get } from "./r2";

// bump when the publish math changes; every activity becomes stale
// v2: privacy zones, distance policy, published start, photo pins
// v3: cleaning edits, raw stats, hr zones, detector suggestions
export const PROCESSING_VERSION = 3;

export type { ZoneInput } from "./privacy/fog";

// ---------------------------------------------------------------------------
// pure core

export interface SourceInput {
  id: number;
  kind: string;
  provider: string;
  externalId: string | null;
  rawSha256: string | null;
}

export interface EditInput {
  id: number;
  kind: string;
  params: Record<string, unknown>;
}

// private photo inputs (from the original's exif)
export interface PhotoInput {
  id: number;
  takenAt: Date | null;
  gpsLat: number | null;
  gpsLng: number | null;
}

export interface PhotoPin {
  id: number;
  pinLat: number | null;
  pinLng: number | null;
}

// which raw objects a track would be built from
export interface TrackRef {
  kind: TrackSourceKind;
  sha256: string;
  detailSha256: string | null;
}

// every candidate track, best first. device files: the first one attached wins
// (a later copy of the same workout, e.g. from a bulk export, never displaces
// the original already publishing). api snapshots: the newest wins.
export function trackCandidates(sources: SourceInput[]): TrackRef[] {
  const newest = (kind: string, provider?: string) =>
    sources
      .filter((s) => s.kind === kind && s.rawSha256 && (!provider || s.provider === provider))
      .sort((a, b) => b.id - a.id);
  const detail = newest("strava-detail")[0]?.rawSha256 ?? null;
  const out: TrackRef[] = [];
  for (const kind of TRACK_SOURCE_PRECEDENCE) {
    if (kind === "device-file") {
      for (const s of newest("device-file").reverse()) out.push({ kind, sha256: s.rawSha256!, detailSha256: null });
    } else if (kind === "strava-streams") {
      if (detail) for (const s of newest("strava-streams")) out.push({ kind, sha256: s.rawSha256!, detailSha256: detail });
    } else if (kind === "strava-polyline") {
      if (detail) out.push({ kind, sha256: detail, detailSha256: detail });
    }
  }
  return out;
}

export function activeEdits(edits: (EditInput & { revertedAt?: Date | null })[]): EditInput[] {
  return edits
    .filter((e) => !e.revertedAt)
    .sort((a, b) => a.id - b.id)
    .map(({ id, kind, params }) => ({ id, kind, params }));
}

// json with sorted keys, so hashes don't depend on object construction order
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(",")}}`;
}

export function inputsHash(input: {
  track: TrackRef | null;
  edits: EditInput[];
  zones: ZoneInput[];
  settings?: PrivacySettings;
  photos?: PhotoInput[];
  processingVersion?: number;
  activity?: ActivitySettings;
  sportType?: string;
  merged?: { ref: TrackRef; edits: EditInput[] }[];
}): string {
  const payload = {
    processingVersion: input.processingVersion ?? PROCESSING_VERSION,
    canonicalFormat: CANONICAL_FORMAT_VERSION,
    track: input.track,
    // hr zone bounds change hr_zones_s; auto-apply only matters through the
    // edits it creates, which are hashed themselves
    hrZones: input.activity ? { max: input.activity.hrMaxBpm, pcts: input.activity.hrZonePcts } : null,
    sportType: input.sportType ?? null,
    merged: input.merged ?? [],
    edits: [...input.edits].sort((a, b) => a.id - b.id),
    zones: [...input.zones].sort((a, b) => a.id - b.id).map((z) => ({ id: z.id, polygon: z.polygon })),
    settings: input.settings ?? DEFAULT_PRIVACY_SETTINGS,
    photos: [...(input.photos ?? [])]
      .sort((a, b) => a.id - b.id)
      .map((p) => ({ id: p.id, takenAt: p.takenAt ? p.takenAt.toISOString() : null, gpsLat: p.gpsLat, gpsLng: p.gpsLng })),
  };
  return createHash("sha256").update(stableStringify(payload)).digest("hex");
}

// latest active trim edit wins; otherwise the legacy default for gps tracks
export function resolveTrim(
  edits: EditInput[],
  gps: boolean,
  defaultTrimM: number = DEFAULT_PRIVACY_TRIM_M
): { startM: number; endM: number } {
  const trims = edits.filter((e) => e.kind === "trim");
  const last = trims[trims.length - 1];
  if (last) {
    const startM = Number(last.params.startM);
    const endM = Number(last.params.endM);
    return {
      startM: Number.isFinite(startM) && startM > 0 ? startM : 0,
      endM: Number.isFinite(endM) && endM > 0 ? endM : 0,
    };
  }
  return gps ? { startM: defaultTrimM, endM: defaultTrimM } : { startM: 0, endM: 0 };
}

// rows written by the legacy pipeline (never republished) with no trim edit —
// e.g. inserted by old code between the migration and the deploy — keep the
// trim they were published with instead of falling back to the default
export function withLegacyTrim(
  row: Pick<ActivityRow, "processingVersion" | "polyline" | "fitSha256" | "trimStartM" | "trimEndM">,
  edits: EditInput[]
): EditInput[] {
  if (row.processingVersion !== 0 || edits.some((e) => e.kind === "trim")) return edits;
  if (!row.polyline && !row.fitSha256) return edits;
  return [{ id: 0, kind: "trim", params: { startM: row.trimStartM, endM: row.trimEndM } }, ...edits];
}

export const OVERRIDABLE_FIELDS = [
  "distanceM",
  "movingTimeS",
  "elapsedTimeS",
  "elevGainM",
  "avgSpeedMs",
  "maxSpeedMs",
  "avgHr",
  "maxHr",
  "avgCadence",
  "avgWatts",
  "maxWatts",
  "kilojoules",
] as const;
type OverridableField = (typeof OVERRIDABLE_FIELDS)[number];

const INTEGER_FIELDS = new Set<OverridableField>(["movingTimeS", "elapsedTimeS"]);
const NULLABLE_FIELDS = new Set<OverridableField>(["avgHr", "maxHr", "avgCadence", "avgWatts", "maxWatts", "kilojoules"]);

// later overrides win field by field; unknown fields and non-numbers are ignored
export function resolveOverrides(edits: EditInput[]): Partial<Record<OverridableField, number | null>> {
  const out: Partial<Record<OverridableField, number | null>> = {};
  for (const e of edits) {
    if (e.kind !== "override") continue;
    for (const field of OVERRIDABLE_FIELDS) {
      if (!(field in e.params)) continue;
      const v = e.params[field];
      if (v === null && NULLABLE_FIELDS.has(field)) out[field] = null;
      else if (typeof v === "number" && Number.isFinite(v) && v >= 0) out[field] = INTEGER_FIELDS.has(field) ? Math.round(v) : v;
    }
  }
  return out;
}

export interface PublicColumns {
  distanceM: number;
  movingTimeS: number;
  elapsedTimeS: number;
  elevGainM: number;
  avgSpeedMs: number;
  maxSpeedMs: number;
  avgHr: number | null;
  maxHr: number | null;
  avgCadence: number | null;
  avgWatts: number | null;
  maxWatts: number | null;
  kilojoules: number | null;
  polyline: string | null;
  cardPolyline: string | null;
  bounds: RouteBounds | null;
  trimStartM: number;
  trimEndM: number;
  fogEvents: FogEvent[] | null;
  fogShapes: number[][][][] | null;
  hrZonesS: number[] | null;
}

export const PUBLIC_COLUMN_NAMES: readonly (keyof PublicColumns)[] = [
  "distanceM", "movingTimeS", "elapsedTimeS", "elevGainM", "avgSpeedMs", "maxSpeedMs",
  "avgHr", "maxHr", "avgCadence", "avgWatts", "maxWatts", "kilojoules",
  "polyline", "cardPolyline", "bounds", "trimStartM", "trimEndM", "fogEvents", "fogShapes", "hrZonesS",
];

const ADDITIVE_COLUMNS = new Set<keyof PublicColumns>(["hrZonesS"]);
const CLEANING_KINDS = new Set<string>(CLEANING_EDIT_KINDS);

export interface PublishContext {
  zones: ZoneInput[];
  settings: PrivacySettings;
  activity?: ActivitySettings; // hr zones (none without)
  merged?: MergedPart[]; // activities merged into this one, with their own edits
  sportType?: string; // the activity's (owner-set) sport; defaults to the track's
}

export interface PublishedTrack {
  columns: PublicColumns;
  // published (post-trim, post-fog) samples, in segments; pins snap to these
  visible: FogSample[][];
  rawStats: RawStats; // the untouched track's stats
  cleaned: boolean;
}

// reduce each visible run to a share of the point budget. one run reduces
// exactly like the pre-fog pipeline did (identical output without zones).
// simplification drops points, and a new straight chord could cut through a
// zone the raw samples went around: put the skipped raw points back for any
// such chord (consecutive raw points never cross a zone — applyFog splits there)
function zoneSafeReduce(run: [number, number][], maxPoints: number, zones: ZoneInput[]): [number, number][] {
  const reduced = rdpReduce(run, maxPoints);
  if (zones.length === 0 || reduced.length === run.length) return reduced;
  const index = new Map(run.map((p, i) => [p, i]));
  const out: [number, number][] = [reduced[0]];
  for (let k = 1; k < reduced.length; k++) {
    const a = reduced[k - 1];
    const b = reduced[k];
    if (zones.some((z) => segmentTouchesPolygon(a, b, z.polygon))) {
      const ia = index.get(a)!;
      const ib = index.get(b)!;
      for (let i = ia + 1; i < ib; i++) out.push(run[i]);
    }
    out.push(b);
  }
  return out;
}

// reduce each visible run to a share of the point budget. one run reduces
// exactly like the pre-fog pipeline did (identical output without zones).
function reduceSegments(runs: [number, number][][], maxPoints: number, zones: ZoneInput[] = []): [number, number][][] {
  const usable = runs.filter((r) => r.length >= 2);
  if (usable.length === 1) return [zoneSafeReduce(usable[0], maxPoints, zones)];
  const total = usable.reduce((n, r) => n + r.length, 0);
  return usable.map((r) => zoneSafeReduce(r, Math.max(2, Math.floor((maxPoints * r.length) / total)), zones));
}

// what is published about the fog: one total, in 5-minute steps. no entry or
// exit points (the route ends already show where it goes in), no per-zone
// shapes, no per-event durations — each would help locate what's hidden.
export function publishedFogEvents(events: FogEvent[]): FogEvent[] | null {
  if (events.length === 0) return null;
  const total = events.reduce((s, e) => s + e.durationS, 0);
  return [{ entry: null, exit: null, durationS: Math.max(300, Math.round(total / 300) * 300) }];
}

// fog applied to an already-published route (trackless rows, or a track that
// can't be read right now): points have no time, so only the route changes
export function fogStoredRoute(
  route: { polyline: string | null; cardPolyline: string | null; bounds: RouteBounds | null },
  zones: ZoneInput[]
): { polyline: string | null; cardPolyline: string | null; bounds: RouteBounds | null; fogged: boolean } {
  if (zones.length === 0 || !route.polyline) return { ...route, fogged: false };
  let fogged = false;
  const fogLine = (encoded: string | null): [number, number][][] => {
    if (!encoded) return [];
    const runs: [number, number][][] = [];
    for (const seg of decodeMultiPolyline(encoded)) {
      const r = applyFog(seg.map(([lat, lng], i) => ({ lat, lng, t: i })), zones);
      if (r.events.length) fogged = true;
      for (const s of r.segments) if (s.length >= 2) runs.push(s.map((p) => [p.lat, p.lng]));
    }
    return runs;
  };
  const detail = fogLine(route.polyline);
  const card = fogLine(route.cardPolyline);
  if (!fogged) return { ...route, fogged: false };
  const pts = detail.flat();
  return {
    polyline: detail.length ? encodeMultiPolyline(detail) : null,
    cardPolyline: card.length ? encodeMultiPolyline(card) : null,
    bounds: pts.length >= 2 ? boundsOf(pts) : null,
    fogged: true,
  };
}

// deterministic: same track + edits + zones + settings → identical output.
// order: cleaning edits (merge, crop, cut, drop points, no gps) on a copy of
// the canonical track → privacy trim → stats → fog → overrides.
export function publishTrack(
  rawTrack: CanonicalTrack,
  edits: EditInput[],
  ctx: PublishContext = { zones: [], settings: DEFAULT_PRIVACY_SETTINGS }
): PublishedTrack {
  // a polyline-only track has made-up timestamps: cleaning can't be timed on
  // it, so it is published untouched (the admin api refuses such edits too)
  const cleaningEdits = rawTrack.syntheticTime ? edits.filter((e) => !CLEANING_KINDS.has(e.kind)) : edits;
  const trim = resolveTrim(edits, hasGps(rawTrack), ctx.settings.defaultTrimM);
  // every merged recording keeps the privacy trim at its own ends too
  const cleaning = applyCleaning(rawTrack, cleaningEdits, rawTrack.syntheticTime ? [] : ctx.merged ?? [], {
    boundaryTrim: trim,
  });
  const track = cleaning.track;
  const parsed = canonicalToParsed(track);
  const zeroTrim = trim.startM === 0 && trim.endM === 0;
  const { kept, keptCum } = zeroTrim
    ? { kept: parsed.records, keptCum: parsed.cumDist }
    : trimByDistance(parsed.records, parsed.cumDist, trim.startM, trim.endM);
  // discontinuities (cuts, merge gaps) aligned to the kept slice
  const first = kept.length ? parsed.records.indexOf(kept[0]) : 0;
  const breaks = kept.map((_, i) => i > 0 && cleaning.breaks[first + i]);
  let excludedS = 0;
  for (let i = 1; i < kept.length; i++) if (breaks[i]) excludedS += kept[i].t - kept[i - 1].t;

  // untouched activities: zero trim uses the device session totals verbatim
  // (no recompute drift) and a polyline-only track keeps its summary, exactly
  // as before cleaning existed. cleaned ones are recomputed from the cleaned track.
  let stats = cleaning.cleaned
    ? cleanedStats(kept, keptCum, breaks, excludedS, ctx.sportType ?? track.sportType)
    : (track.syntheticTime && track.session) || (zeroTrim && parsed.sessionStats)
      ? parsed.sessionStats!
      : computeStats(kept, keptCum);

  // fog per continuous run, so nothing is ever drawn across a cut
  const fog: { segments: FogSample[][]; events: FogEvent[]; visibleDistanceM: number } = { segments: [], events: [], visibleDistanceM: 0 };
  let run: FogSample[] = [];
  const flushRun = () => {
    if (!run.length) return;
    const r = applyFog(run, ctx.zones);
    fog.segments.push(...r.segments);
    fog.events.push(...r.events);
    fog.visibleDistanceM += r.visibleDistanceM;
    run = [];
  };
  for (let i = 0; i < kept.length; i++) {
    if (breaks[i]) flushRun();
    const r = kept[i];
    if (r.lat !== null && r.lng !== null) run.push({ lat: r.lat, lng: r.lng, t: r.t });
  }
  flushRun();
  const fogged = fog.events.length > 0;
  if (fogged) {
    stats = { ...stats, distanceM: publishedDistance(stats.distanceM, fog.visibleDistanceM, true, ctx.settings.distance) };
  }

  const runs = fog.segments.map((seg) => seg.map((s) => [s.lat, s.lng] as [number, number]));
  const visiblePoints = runs.reduce((n, r) => n + (r.length >= 2 ? r.length : 0), 0);
  let polyline: string | null = null;
  let cardPolyline: string | null = null;
  let bounds: RouteBounds | null = null;
  if (visiblePoints >= 2) {
    const detail = reduceSegments(runs, DETAIL_POLYLINE_MAX_POINTS, ctx.zones);
    polyline = encodeMultiPolyline(detail);
    cardPolyline = encodeMultiPolyline(reduceSegments(runs, CARD_POLYLINE_MAX_POINTS, ctx.zones));
    bounds = boundsOf(detail.flat());
  }

  const columns = {
    ...stats,
    kilojoules: track.kilojoules,
    polyline,
    cardPolyline,
    bounds,
    trimStartM: Math.max(0, trim.startM),
    trimEndM: Math.max(0, trim.endM),
    fogEvents: publishedFogEvents(fog.events),
    fogShapes: null, // zone shapes are never published (the shape would reveal the place)
    hrZonesS: ctx.activity
      ? hrZoneSeconds(kept, breaks, ctx.activity.hrMaxBpm, ctx.activity.hrZonePcts)
      : null,
    ...resolveOverrides(edits),
  } as PublicColumns;
  const rawParsed = canonicalToParsed(rawTrack);
  return {
    columns,
    visible: fog.segments,
    rawStats: rawStatsOf(rawTrack.session, rawParsed.records, rawParsed.cumDist),
    cleaned: cleaning.cleaned,
  };
}

export function computePublicColumns(track: CanonicalTrack, edits: EditInput[], ctx?: PublishContext): PublicColumns {
  return publishTrack(track, edits, ctx).columns;
}

// stable identity of a suggestion across re-detection
export function suggestionFingerprint(s: Suggestion): string {
  return createHash("sha256").update(stableStringify({ kind: s.kind, edit: s.edit, range: s.range })).digest("hex");
}

export function boundsOfTracks(tracks: CanonicalTrack[]): RouteBounds | null {
  const bs = tracks.map(trackBounds).filter((b): b is RouteBounds => b !== null);
  if (!bs.length) return null;
  return {
    minLat: Math.min(...bs.map((b) => b.minLat)),
    minLng: Math.min(...bs.map((b) => b.minLng)),
    maxLat: Math.max(...bs.map((b) => b.maxLat)),
    maxLng: Math.max(...bs.map((b) => b.maxLng)),
  };
}

// bounds of every gps point of the full (untrimmed, unfogged) track. PRIVATE:
// only used to find the zones that can touch the activity.
export function trackBounds(track: CanonicalTrack): RouteBounds | null {
  const pts: [number, number][] = [];
  const c = track.columns;
  for (let i = 0; i < c.t.length; i++) if (c.lat[i] !== null && c.lng[i] !== null) pts.push([c.lat[i]!, c.lng[i]!]);
  return boundsOf(pts);
}

const PIN_SNAP_M = 75;
const round4 = (v: number) => Math.round(v * 1e4) / 1e4;

// a photo gets a public pin only where the published route is: next to a
// visible (post-trim, post-fog) point and outside every zone. position from
// its own gps, else interpolated along the visible track at the time taken.
export function computePhotoPins(
  photos: PhotoInput[],
  track: CanonicalTrack | null,
  visible: FogSample[][],
  zones: ZoneInput[]
): PhotoPin[] {
  const none = (id: number): PhotoPin => ({ id, pinLat: null, pinLng: null });
  if (!track) return photos.map((p) => none(p.id));
  return photos.map((p) => {
    let pos: [number, number] | null = null;
    if (p.gpsLat !== null && p.gpsLng !== null) {
      pos = [p.gpsLat, p.gpsLng];
    } else if (p.takenAt) {
      const t = (p.takenAt.getTime() - track.startEpochMs) / 1000;
      for (const seg of visible) {
        for (let i = 1; i < seg.length && !pos; i++) {
          const a = seg[i - 1];
          const b = seg[i];
          if (t >= a.t && t <= b.t) {
            const f = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0;
            pos = [a.lat + (b.lat - a.lat) * f, a.lng + (b.lng - a.lng) * f];
          }
        }
        if (pos) break;
      }
    }
    if (!pos) return none(p.id);
    const near = visible.some((seg) => seg.some((s) => haversineM(s.lat, s.lng, pos![0], pos![1]) <= PIN_SNAP_M));
    if (!near) return none(p.id);
    const pin: [number, number] = [round4(pos[0]), round4(pos[1])];
    if (zonesContaining(pos[0], pos[1], zones).length || zonesContaining(pin[0], pin[1], zones).length) return none(p.id);
    return { id: p.id, pinLat: pin[0], pinLng: pin[1] };
  });
}

// published start: floored to the coarsening step in LOCAL wall time (steps
// divide a day, so the local date never changes), then mapped back to utc
export function publishedStart(row: Pick<ActivityRow, "startDateUtc" | "utcOffsetMin">, settings: PrivacySettings) {
  const offsetMs = row.utcOffsetMin * 60000;
  const localFloored = coarsenStart(new Date(row.startDateUtc.getTime() + offsetMs), settings.coarsenStartMin);
  const publishedStartUtc = new Date(localFloored.getTime() - offsetMs);
  return { publishedStartUtc, publishedLocalTime: localDateTime(publishedStartUtc, row.utcOffsetMin).localTime };
}

export function diffColumns(row: Partial<ActivityRow>, cols: PublicColumns): (keyof PublicColumns)[] {
  const changed: (keyof PublicColumns)[] = [];
  for (const k of PUBLIC_COLUMN_NAMES) {
    const a = row[k as keyof ActivityRow];
    const b = cols[k];
    // a metric appearing for the first time adds data, it doesn't change any
    if (ADDITIVE_COLUMNS.has(k) && (a === null || a === undefined)) continue;
    if (typeof a === "number" && typeof b === "number") {
      if (Math.abs(a - b) > 1e-6 * Math.max(1, Math.abs(a))) changed.push(k);
    } else if (stableStringify(a ?? null) !== stableStringify(b ?? null)) {
      changed.push(k);
    }
  }
  return changed;
}

// ---------------------------------------------------------------------------
// io

export interface RepublishDeps {
  loadActivity(id: number): Promise<ActivityRow | null>;
  loadSources(id: number): Promise<SourceInput[]>;
  loadEdits(id: number): Promise<EditInput[]>; // active only
  loadZones(): Promise<ZoneInput[]>; // enabled, not archived
  loadRaw(sha256: string, row: ActivityRow): Promise<Uint8Array | null>;
  storeDerived(key: string, bytes: Uint8Array): Promise<boolean>; // false when no private store
  // startedAt: when needsRepublish is cleared, keep it set if the row was
  // marked stale after this time (an edit raced the republish)
  writeColumns(id: number, values: Record<string, unknown>, startedAt?: Date): Promise<void>;
  recordEdit?(id: number, kind: string, params: Record<string, unknown>, note: string): Promise<number>;
  // optional so read-only/legacy deps keep working: defaults, no photos
  loadSettings?(): Promise<PrivacySettings>;
  loadPhotos?(id: number): Promise<PhotoInput[]>;
  writePhotoPins?(id: number, pins: PhotoPin[]): Promise<void>;
  loadActivitySettings?(): Promise<ActivitySettings>;
  // store detector output (insert-only per fingerprint); when autoApplyMin is
  // set, open suggestions at/above it become edits — returns those edits
  recordSuggestions?(
    id: number,
    suggestions: Suggestion[],
    autoApplyMin: number | null,
    currentEdits?: EditInput[],
    anchorEpochMs?: number
  ): Promise<EditInput[]>;
  // flag another activity for rebuild (merge targets of an absorbed activity)
  markStale?(id: number): Promise<void>;
}

export type RepublishResult =
  | { status: "not-found"; id: number }
  | { status: "fresh"; id: number; hash: string }
  | { status: "no-source"; id: number; hash: string } // nothing to build a track from
  | { status: "source-unavailable"; id: number; hash: string; track: TrackRef } // best source's bytes unreadable
  | {
      status: "published" | "would-publish";
      id: number;
      hash: string;
      track: TrackRef;
      changed: (keyof PublicColumns)[];
      columns: PublicColumns;
      canonicalTrackKey: string | null;
      pins: PhotoPin[];
    };

export interface RepublishOptions {
  force?: boolean; // rebuild even when the inputs hash is current
  dryRun?: boolean; // compute everything, write nothing
  deps?: RepublishDeps;
}

// "unavailable": raw bytes not reachable (never silently downgrade past it);
// null: the bytes are there but hold no track (try the next source)
export async function buildTrack(
  ref: TrackRef,
  row: ActivityRow,
  deps: RepublishDeps
): Promise<CanonicalTrack | null | "unavailable"> {
  const bytes = await deps.loadRaw(ref.sha256, row);
  if (!bytes) return "unavailable";
  if (ref.kind === "device-file") {
    try {
      return canonicalFromDeviceFile(bytes, `${ref.sha256}.${row.fileType ?? "fit"}`, ref.sha256);
    } catch (error) {
      // indoor/manual exports are gpx shells with no timed points: not a track,
      // so fall through to the next source instead of failing the activity
      if ((error as Error).message.includes("could not extract a timed track")) return null;
      throw error;
    }
  }
  const detailBytes = ref.kind === "strava-polyline" ? bytes : await deps.loadRaw(ref.detailSha256!, row);
  if (!detailBytes) return "unavailable";
  const detail = JSON.parse(new TextDecoder().decode(detailBytes)) as StravaDetailLike;
  if (ref.kind === "strava-streams") {
    return canonicalFromStravaStreams(detail, JSON.parse(new TextDecoder().decode(bytes)), {
      streamsSha256: ref.sha256,
      detailSha256: ref.detailSha256!,
    });
  }
  return canonicalFromStravaPolyline(detail, ref.sha256);
}

export async function republish(activityId: number, opts: RepublishOptions = {}): Promise<RepublishResult> {
  const deps = opts.deps ?? defaultDeps();
  // an edit that marks the row stale after this point keeps it pending
  const startedAt = new Date();
  const row = await deps.loadActivity(activityId);
  if (!row) return { status: "not-found", id: activityId };

  const [sources, storedEdits, allZones, settings, photos] = await Promise.all([
    deps.loadSources(activityId),
    deps.loadEdits(activityId),
    deps.loadZones(),
    deps.loadSettings ? deps.loadSettings() : Promise.resolve(DEFAULT_PRIVACY_SETTINGS),
    deps.loadPhotos ? deps.loadPhotos(activityId) : Promise.resolve([] as PhotoInput[]),
  ]);
  let edits = withLegacyTrim(row, storedEdits);
  const candidates = trackCandidates(sources);
  // persist a synthesized legacy trim as a real edit before publishing with it,
  // so the next run (processing_version no longer 0) still sees it
  const synthesized = edits.find((e) => e.id === 0);
  if (synthesized && !opts.dryRun && deps.recordEdit && candidates.length > 0) {
    const id = await deps.recordEdit(activityId, synthesized.kind, synthesized.params, "legacy trim kept at first republish");
    edits = edits.map((e) => (e === synthesized ? { ...e, id } : e));
  }

  const activity = deps.loadActivitySettings ? await deps.loadActivitySettings() : DEFAULT_ACTIVITY_SETTINGS;
  // activities merged into this one: their best track source is an input too
  const merges: { id: number; row: ActivityRow; ref: TrackRef; edits: EditInput[] }[] = [];
  for (const otherId of mergeTargets(edits)) {
    if (otherId === activityId) continue;
    const other = await deps.loadActivity(otherId);
    const ref = other ? trackCandidates(await deps.loadSources(otherId))[0] : undefined;
    // the absorbed activity's own cleaning applies to its part
    const own = other && ref ? (await deps.loadEdits(otherId)).filter((e) => CLEANING_KINDS.has(e.kind) && e.kind !== "merge") : [];
    if (other && ref) merges.push({ id: otherId, row: other, ref, edits: own });
  }
  // an absorbed activity whose inputs changed makes its target stale
  const mergedInto = edits.filter((e) => e.kind === "merged-into").map((e) => Number(e.params.intoActivityId)).filter((n) => Number.isInteger(n) && n > 0);

  const best = candidates[0] ?? null;
  // the route a trackless row publishes from: kept privately the first time
  const storedRoute = row.legacyRoute ?? { polyline: row.polyline, cardPolyline: row.cardPolyline, bounds: row.bounds };
  // only zones that can touch the activity count, so a zone edit elsewhere
  // never marks it stale (trackless rows: zones near their stored route)
  const hashFor = (track: TrackRef | null, bbox: RouteBounds | null) =>
    inputsHash({
      track,
      edits,
      zones: relevantZones(allZones, track ? bbox : storedRoute.bounds),
      settings,
      photos,
      activity,
      sportType: row.sportType,
      merged: merges.map((m) => ({ ref: m.ref, edits: m.edits })),
    });
  const bestHash = hashFor(best, row.trackBbox ?? null);
  if (!opts.force && row.publishedInputsHash === bestHash && row.processingVersion === PROCESSING_VERSION) {
    if (row.needsRepublish && !opts.dryRun) await deps.writeColumns(activityId, { needsRepublish: false }, startedAt);
    return { status: "fresh", id: activityId, hash: bestHash };
  }
  const start = publishedStart(row, settings);

  // fail closed: when the track can't be rebuilt right now, the route already
  // published still gets the current zones applied (it only ever loses points)
  const fogCurrentRoute = async () => {
    if (opts.dryRun) return;
    const current = { polyline: row.polyline, cardPolyline: row.cardPolyline, bounds: row.bounds };
    const f = fogStoredRoute(current, relevantZones(allZones, current.bounds));
    if (f.fogged) {
      await deps.writeColumns(activityId, { polyline: f.polyline, cardPolyline: f.cardPolyline, bounds: f.bounds, fogShapes: null, updatedAt: new Date() });
    }
  };

  // best source first; skip sources that hold no track, but stop (write
  // nothing but fog) when a better source's bytes can't be read — publishing
  // a worse track over it would silently replace device data
  for (const ref of candidates) {
    let track: Awaited<ReturnType<typeof buildTrack>>;
    try {
      track = await buildTrack(ref, row, deps);
    } catch (error) {
      await fogCurrentRoute();
      throw error;
    }
    if (track === "unavailable") {
      await fogCurrentRoute();
      return { status: "source-unavailable", id: activityId, hash: bestHash, track: ref };
    }
    if (!track) continue;

    // merged activities' tracks (a merge whose track can't be read waits)
    const merged: MergedPart[] = [];
    for (const m of merges) {
      const t = await buildTrack(m.ref, m.row, deps);
      if (t === "unavailable") {
        await fogCurrentRoute();
        return { status: "source-unavailable", id: activityId, hash: bestHash, track: m.ref };
      }
      if (t) merged.push({ track: t, edits: m.edits });
    }

    // detector suggestions on the untouched track, kept only where they still
    // apply (inside the crop window in effect). with auto-apply on, confident
    // ones become edits right away (still reversible) — never for sports
    // without real speed limits, and never on route-only tracks
    if (!opts.dryRun && deps.recordSuggestions && !track.syntheticTime) {
      const { lo, hi } = effectiveCropWindow(edits, track);
      const suggestions = detectSuggestions(track, row.sportType).filter((s) => !s.range || (s.range.toS > lo && s.range.fromS < hi));
      const knownSport = isKnownSport(row.sportType);
      const autoMin = activity.autoApply.enabled && knownSport ? activity.autoApply.minConfidence : null;
      const accepted = await deps.recordSuggestions(activityId, suggestions, autoMin, edits, track.startEpochMs);
      if (accepted.length) edits = [...edits, ...accepted].sort((a, b) => a.id - b.id);
    }

    const bbox = boundsOfTracks([track, ...merged.map((m) => m.track)]);
    const zones = relevantZones(allZones, bbox);
    const hash = hashFor(ref, bbox);
    const published = publishTrack(track, edits, { zones, settings, activity, merged, sportType: row.sportType });
    const { columns, visible } = published;
    const pins = computePhotoPins(photos, track, visible, zones);
    const changed = diffColumns(row, columns);
    const serialized = serializeCanonical(track);
    const key = canonicalTrackKey(serialized);
    if (opts.dryRun) {
      return { status: "would-publish", id: activityId, hash, track: ref, changed, columns, canonicalTrackKey: key, pins };
    }
    const stored = await deps.storeDerived(key, serialized);
    if (deps.writePhotoPins && pins.length) await deps.writePhotoPins(activityId, pins);
    await deps.writeColumns(activityId, {
      ...columns,
      ...start,
      rawStats: published.rawStats,
      trackBbox: bbox,
      needsRepublish: false,
      processingVersion: PROCESSING_VERSION,
      publishedInputsHash: hash,
      canonicalTrackKey: stored ? key : null,
      updatedAt: new Date(),
    }, startedAt);
    if (deps.markStale) for (const target of mergedInto) await deps.markStale(target);
    return { status: "published", id: activityId, hash, track: ref, changed, columns, canonicalTrackKey: stored ? key : null, pins };
  }

  // trackless (manual entries, gym sessions, file-less api rows not yet
  // snapshotted): stats are left exactly as they are; the route they came with
  // (kept privately) is published with the current zones applied, so adding a
  // zone fogs it and removing one restores it. no photo gets a pin.
  if (!opts.dryRun) {
    if (deps.writePhotoPins && photos.length) {
      await deps.writePhotoPins(activityId, computePhotoPins(photos, null, [], []));
    }
    const f = fogStoredRoute(storedRoute, relevantZones(allZones, storedRoute.bounds));
    await deps.writeColumns(activityId, {
      ...start,
      ...(storedRoute.polyline
        ? {
            legacyRoute: storedRoute,
            polyline: f.polyline,
            cardPolyline: f.cardPolyline,
            bounds: f.bounds,
            fogEvents: null, // no timestamps: nothing to say about time in the fog
            fogShapes: null,
          }
        : {}),
      needsRepublish: false,
      processingVersion: PROCESSING_VERSION,
      publishedInputsHash: bestHash,
      updatedAt: new Date(),
    }, startedAt);
  }
  return { status: "no-source", id: activityId, hash: bestHash };
}

// raw bytes: private raw store first; legacy originals still in the public
// bucket are read from the row's fit_blob_pathname (hash-verified) until
// migrate-originals-private has copied them over
export async function loadRawBytes(sha256: string, row: Pick<ActivityRow, "fitSha256" | "fitBlobPathname">): Promise<Uint8Array | null> {
  if (isRawStoreConfigured()) {
    const bytes = await getRawStore().tryGet(sha256);
    if (bytes) return bytes;
  }
  if (row.fitSha256 === sha256 && row.fitBlobPathname) {
    const bytes = await r2Get(row.fitBlobPathname);
    const actual = sha256Hex(bytes);
    if (actual !== sha256) throw new Error(`legacy original ${row.fitBlobPathname} hashes to ${actual}, expected ${sha256}`);
    return bytes;
  }
  return null;
}

export function defaultDeps(): RepublishDeps {
  const db = getDb();
  return {
    async loadActivity(id) {
      const rows = await db.select().from(activities).where(eq(activities.id, id)).limit(1);
      return rows[0] ?? null;
    },
    async loadSources(id) {
      return db
        .select({
          id: activitySources.id,
          kind: activitySources.kind,
          provider: activitySources.provider,
          externalId: activitySources.externalId,
          rawSha256: activitySources.rawSha256,
        })
        .from(activitySources)
        .where(eq(activitySources.activityId, id));
    },
    async loadEdits(id) {
      return db
        .select({ id: activityEdits.id, kind: activityEdits.kind, params: activityEdits.params })
        .from(activityEdits)
        .where(and(eq(activityEdits.activityId, id), isNull(activityEdits.revertedAt)))
        .orderBy(asc(activityEdits.id));
    },
    async loadZones() {
      return db
        .select({ id: privacyZones.id, polygon: privacyZones.polygon })
        .from(privacyZones)
        .where(and(eq(privacyZones.enabled, true), isNull(privacyZones.archivedAt)))
        .orderBy(asc(privacyZones.id));
    },
    loadSettings: loadPrivacySettings,
    async loadPhotos(id) {
      return db
        .select({ id: activityPhotos.id, takenAt: activityPhotos.takenAt, gpsLat: activityPhotos.gpsLat, gpsLng: activityPhotos.gpsLng })
        .from(activityPhotos)
        .where(eq(activityPhotos.activityId, id))
        .orderBy(asc(activityPhotos.id));
    },
    async writePhotoPins(id, pins) {
      // one statement per photo (neon-http: no transactions); pins only
      for (const p of pins) {
        await db
          .update(activityPhotos)
          .set({ pinLat: p.pinLat, pinLng: p.pinLng })
          .where(and(eq(activityPhotos.id, p.id), eq(activityPhotos.activityId, id)));
      }
    },
    loadRaw: loadRawBytes,
    async storeDerived(key, bytes) {
      if (!isRawStoreConfigured()) return false;
      await getRawStore().putDerived(key, bytes, "application/gzip");
      return true;
    },
    async writeColumns(id, values, startedAt) {
      const set: Record<string, unknown> = { ...values };
      if (values.needsRepublish === false && startedAt) {
        set.needsRepublish = sql`(${activities.staleMarkedAt} is not null and ${activities.staleMarkedAt} > ${startedAt.toISOString()}::timestamptz)`;
      }
      await db.update(activities).set(set).where(eq(activities.id, id));
    },
    loadActivitySettings,
    async markStale(id) {
      await db.update(activities).set({ needsRepublish: true, staleMarkedAt: new Date() }).where(eq(activities.id, id));
    },
    async recordSuggestions(id, suggestions, autoApplyMin, _currentEdits, anchorEpochMs) {
      if (!suggestions.length) return [];
      const rows = suggestions.map((s) => ({
        activityId: id,
        detectorVersion: DETECTOR_VERSION,
        fingerprint: suggestionFingerprint(s),
        kind: s.kind,
        confidence: s.confidence,
        edit: s.edit,
        summary: s.summary,
        range: s.range,
      }));
      // insert-only: a dismissed or accepted suggestion keeps its decision
      await db.insert(activitySuggestions).values(rows).onConflictDoNothing();
      if (autoApplyMin === null) return [];
      const all = await db
        .select()
        .from(activitySuggestions)
        .where(eq(activitySuggestions.activityId, id))
        .orderBy(asc(activitySuggestions.id));
      // never re-apply what the owner already decided on (any detector
      // version), or an equal edit they reverted
      const editKey = (e: { kind: string; params: Record<string, unknown> } | null) =>
        e ? stableStringify({ kind: e.kind, params: Object.fromEntries(Object.entries(e.params).filter(([k]) => k !== "anchorEpochMs")) }) : "";
      const decided = new Set(all.filter((s) => s.status !== "open").map((s) => editKey(s.edit)));
      const reverted = await db
        .select({ kind: activityEdits.kind, params: activityEdits.params })
        .from(activityEdits)
        .where(and(eq(activityEdits.activityId, id), isNotNull(activityEdits.revertedAt)));
      for (const r of reverted) decided.add(editKey(r));
      const created: EditInput[] = [];
      for (const s of all) {
        if (s.detectorVersion !== DETECTOR_VERSION || s.status !== "open") continue;
        if (!s.edit || s.confidence < autoApplyMin || decided.has(editKey(s.edit))) continue;
        // claim the suggestion first: an admin decision that got there first wins
        const claimed = await db
          .update(activitySuggestions)
          .set({ status: "accepted", decidedAt: new Date() })
          .where(and(eq(activitySuggestions.id, s.id), eq(activitySuggestions.status, "open")))
          .returning({ id: activitySuggestions.id });
        if (!claimed.length) continue;
        const params = anchorEpochMs ? { ...s.edit.params, anchorEpochMs } : s.edit.params;
        const inserted = await db
          .insert(activityEdits)
          .values({ activityId: id, kind: s.edit.kind, params, note: `auto-applied: ${s.summary}` })
          .returning({ id: activityEdits.id });
        await db.update(activitySuggestions).set({ editId: inserted[0].id }).where(eq(activitySuggestions.id, s.id));
        created.push({ id: inserted[0].id, kind: s.edit.kind, params });
        decided.add(editKey(s.edit));
      }
      return created;
    },
    async recordEdit(id, kind, params, note) {
      const rows = await db
        .insert(activityEdits)
        .values({ activityId: id, kind, params, note })
        .returning({ id: activityEdits.id });
      return rows[0].id;
    },
  };
}
