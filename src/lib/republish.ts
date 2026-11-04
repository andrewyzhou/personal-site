// republish(activityId): the only writer of an activity's published route/stat
// columns. deterministic from (canonical track, active edits, privacy zones,
// processing version); the inputs hash makes staleness checks cheap and lets
// bulk rebuilds skip anything already current. raw inputs are never touched.
//
// a0 scope: trim (default 200 m for gps tracks without a trim edit, the legacy
// behavior) + whitelisted stat overrides. zones are hashed now so a zone edit
// marks activities stale; applying them is a1. identity/metadata columns (name,
// sport, start/local time, hidden) are not written here. server-only.

import { createHash } from "crypto";
import { and, asc, eq, isNull } from "drizzle-orm";
import {
  getDb,
  activities,
  activitySources,
  activityEdits,
  privacyZones,
  type ActivityRow,
  type RouteBounds,
} from "./db";
import { computePublished, DEFAULT_PRIVACY_TRIM_M } from "./activities";
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
export const PROCESSING_VERSION = 1;

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

export interface ZoneInput {
  id: number;
  polygon: number[][][];
}

// which raw objects a track would be built from
export interface TrackRef {
  kind: TrackSourceKind;
  sha256: string;
  detailSha256: string | null;
}

// every candidate track, best first. within a kind the newest source row wins.
export function trackCandidates(sources: SourceInput[]): TrackRef[] {
  const newest = (kind: string, provider?: string) =>
    sources
      .filter((s) => s.kind === kind && s.rawSha256 && (!provider || s.provider === provider))
      .sort((a, b) => b.id - a.id);
  const detail = newest("strava-detail")[0]?.rawSha256 ?? null;
  const out: TrackRef[] = [];
  for (const kind of TRACK_SOURCE_PRECEDENCE) {
    if (kind === "device-file") {
      for (const s of newest("device-file")) out.push({ kind, sha256: s.rawSha256!, detailSha256: null });
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
  processingVersion?: number;
}): string {
  const payload = {
    processingVersion: input.processingVersion ?? PROCESSING_VERSION,
    canonicalFormat: CANONICAL_FORMAT_VERSION,
    track: input.track,
    edits: [...input.edits].sort((a, b) => a.id - b.id),
    zones: [...input.zones].sort((a, b) => a.id - b.id),
  };
  return createHash("sha256").update(stableStringify(payload)).digest("hex");
}

// latest active trim edit wins; otherwise the legacy default for gps tracks
export function resolveTrim(edits: EditInput[], gps: boolean): { startM: number; endM: number } {
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
  return gps ? { startM: DEFAULT_PRIVACY_TRIM_M, endM: DEFAULT_PRIVACY_TRIM_M } : { startM: 0, endM: 0 };
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
}

export const PUBLIC_COLUMN_NAMES: readonly (keyof PublicColumns)[] = [
  "distanceM", "movingTimeS", "elapsedTimeS", "elevGainM", "avgSpeedMs", "maxSpeedMs",
  "avgHr", "maxHr", "avgCadence", "avgWatts", "maxWatts", "kilojoules",
  "polyline", "cardPolyline", "bounds", "trimStartM", "trimEndM",
];

// deterministic: same track + edits → identical columns
export function computePublicColumns(track: CanonicalTrack, edits: EditInput[]): PublicColumns {
  const trim = resolveTrim(edits, hasGps(track));
  const pub = computePublished(canonicalToParsed(track), trim.startM, trim.endM);
  // a polyline-only track has made-up timestamps: its route can be trimmed, but
  // the stats stay the provider's summary
  const stats = track.syntheticTime && track.session ? track.session : pub.stats;
  const cols: PublicColumns = {
    ...stats,
    kilojoules: track.kilojoules,
    polyline: pub.polyline,
    cardPolyline: pub.cardPolyline,
    bounds: pub.bounds,
    trimStartM: pub.trimStartM,
    trimEndM: pub.trimEndM,
  };
  return { ...cols, ...resolveOverrides(edits) } as PublicColumns;
}

export function diffColumns(row: Partial<ActivityRow>, cols: PublicColumns): (keyof PublicColumns)[] {
  const changed: (keyof PublicColumns)[] = [];
  for (const k of PUBLIC_COLUMN_NAMES) {
    const a = row[k as keyof ActivityRow];
    const b = cols[k];
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
  loadZones(): Promise<ZoneInput[]>; // enabled only
  loadRaw(sha256: string, row: ActivityRow): Promise<Uint8Array | null>;
  storeDerived(key: string, bytes: Uint8Array): Promise<boolean>; // false when no private store
  writeColumns(id: number, values: Record<string, unknown>): Promise<void>;
}

export type RepublishResult =
  | { status: "not-found"; id: number }
  | { status: "fresh"; id: number; hash: string }
  | { status: "no-source"; id: number; hash: string } // nothing to build a track from
  | {
      status: "published" | "would-publish";
      id: number;
      hash: string;
      track: TrackRef;
      changed: (keyof PublicColumns)[];
      columns: PublicColumns;
      canonicalTrackKey: string | null;
    };

export interface RepublishOptions {
  force?: boolean; // rebuild even when the inputs hash is current
  dryRun?: boolean; // compute everything, write nothing
  deps?: RepublishDeps;
}

async function buildTrack(ref: TrackRef, row: ActivityRow, deps: RepublishDeps): Promise<CanonicalTrack | null> {
  const bytes = await deps.loadRaw(ref.sha256, row);
  if (!bytes) return null;
  if (ref.kind === "device-file") {
    return canonicalFromDeviceFile(bytes, `${ref.sha256}.${row.fileType ?? "fit"}`, ref.sha256);
  }
  const detailBytes = ref.kind === "strava-polyline" ? bytes : await deps.loadRaw(ref.detailSha256!, row);
  if (!detailBytes) return null;
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
  const row = await deps.loadActivity(activityId);
  if (!row) return { status: "not-found", id: activityId };

  const [sources, edits, zones] = await Promise.all([
    deps.loadSources(activityId),
    deps.loadEdits(activityId),
    deps.loadZones(),
  ]);
  const candidates = trackCandidates(sources);

  const best = candidates[0] ?? null;
  const bestHash = inputsHash({ track: best, edits, zones });
  if (!opts.force && row.publishedInputsHash === bestHash && row.processingVersion === PROCESSING_VERSION) {
    return { status: "fresh", id: activityId, hash: bestHash };
  }

  // best source first; fall through when its raw bytes aren't reachable yet
  for (const ref of candidates) {
    const track = await buildTrack(ref, row, deps);
    if (!track) continue;
    const hash = inputsHash({ track: ref, edits, zones });
    const columns = computePublicColumns(track, edits);
    const changed = diffColumns(row, columns);
    const serialized = serializeCanonical(track);
    const key = canonicalTrackKey(serialized);
    if (opts.dryRun) {
      return { status: "would-publish", id: activityId, hash, track: ref, changed, columns, canonicalTrackKey: key };
    }
    const stored = await deps.storeDerived(key, serialized);
    await deps.writeColumns(activityId, {
      ...columns,
      processingVersion: PROCESSING_VERSION,
      publishedInputsHash: hash,
      canonicalTrackKey: stored ? key : null,
      updatedAt: new Date(),
    });
    return { status: "published", id: activityId, hash, track: ref, changed, columns, canonicalTrackKey: stored ? key : null };
  }

  // trackless (manual entries, gym sessions, file-less api rows not yet
  // snapshotted): published columns are left exactly as they are
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
        .where(eq(privacyZones.enabled, true));
    },
    loadRaw: loadRawBytes,
    async storeDerived(key, bytes) {
      if (!isRawStoreConfigured()) return false;
      await getRawStore().putDerived(key, bytes, "application/gzip");
      return true;
    },
    async writeColumns(id, values) {
      await db.update(activities).set(values).where(eq(activities.id, id));
    },
  };
}
