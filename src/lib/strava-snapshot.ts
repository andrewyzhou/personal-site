// strava api snapshot planning, pure: which (activity, endpoint) reads are still
// missing from the raw store, in what order, and the resume checkpoint format.
// the io lives in scripts/strava-api-snapshot.mts.

export const SNAPSHOT_KINDS = ["strava-detail", "strava-streams", "strava-laps", "strava-photos"] as const;
export type SnapshotKind = (typeof SNAPSHOT_KINDS)[number];

export const STREAM_KEYS = [
  "time", "latlng", "altitude", "distance", "heartrate", "cadence", "watts",
  "velocity_smooth", "temp", "moving", "grade_smooth",
] as const;

// legacy activity sources that carry a strava activity id in external_id
export const STRAVA_ID_SOURCES = ["strava-archive", "strava-api", "manual"] as const;

// path + query under https://www.strava.com/api/v3
export function snapshotEndpoint(kind: SnapshotKind, stravaId: string): string {
  const id = encodeURIComponent(stravaId);
  switch (kind) {
    case "strava-detail":
      return `/activities/${id}?include_all_efforts=true`;
    case "strava-streams":
      return `/activities/${id}/streams?keys=${STREAM_KEYS.join(",")}&key_by_type=true`;
    case "strava-laps":
      return `/activities/${id}/laps`;
    case "strava-photos":
      return `/activities/${id}/photos?size=5000&photo_sources=true`;
  }
}

export const pairKey = (stravaId: string, kind: string) => `${stravaId}:${kind}`;

const STRAVA_ID_RE = /^\d+$/;

export interface StravaTarget {
  stravaId: string;
  activityId: number;
}

export interface CollectResult {
  targets: StravaTarget[]; // sorted by numeric strava id
  unmatched: string[]; // csv ids with no activity to link to
  conflicts: { stravaId: string; activityIds: number[] }[]; // one id on several activities
}

// union of activity_sources strava ids, legacy external ids and (optionally)
// csv ids. every target needs an activity: snapshots are linked as sources.
export function collectStravaTargets(input: {
  sources: { activityId: number; externalId: string | null }[];
  legacy: { id: number; externalId: string | null; source: string }[];
  csvIds?: string[];
}): CollectResult {
  const byId = new Map<string, Set<number>>();
  const add = (stravaId: string | null, activityId: number) => {
    const id = stravaId?.trim();
    if (!id || !STRAVA_ID_RE.test(id)) return;
    if (!byId.has(id)) byId.set(id, new Set());
    byId.get(id)!.add(activityId);
  };
  for (const s of input.sources) add(s.externalId, s.activityId);
  for (const r of input.legacy) {
    if ((STRAVA_ID_SOURCES as readonly string[]).includes(r.source)) add(r.externalId, r.id);
  }
  const unmatched: string[] = [];
  for (const raw of input.csvIds ?? []) {
    const id = raw.trim();
    if (STRAVA_ID_RE.test(id) && !byId.has(id) && !unmatched.includes(id)) unmatched.push(id);
  }
  const targets: StravaTarget[] = [];
  const conflicts: CollectResult["conflicts"] = [];
  for (const [stravaId, ids] of byId) {
    const sorted = [...ids].sort((a, b) => a - b);
    if (sorted.length > 1) conflicts.push({ stravaId, activityIds: sorted });
    // lowest activity id wins; the conflict is reported, not guessed at further
    targets.push({ stravaId, activityId: sorted[0] });
  }
  const numeric = (a: string, b: string) => (BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0);
  targets.sort((a, b) => numeric(a.stravaId, b.stravaId));
  unmatched.sort(numeric);
  return { targets, unmatched, conflicts };
}

export interface PlannedRequest {
  stravaId: string;
  activityId: number;
  kind: SnapshotKind;
  path: string;
}

export interface PlanResult {
  requests: PlannedRequest[];
  skippedStored: number; // already an activity_sources row of that kind
  skippedCheckpoint: number; // done or gone per the local checkpoint
}

// kind-major order: every detail first, then streams, laps, photos. a run cut
// short by the daily limit still leaves the most useful kinds complete.
export function buildPlan(
  targets: StravaTarget[],
  opts: { stored?: Set<string>; checkpoint?: Checkpoint; kinds?: readonly SnapshotKind[]; retryGone?: boolean } = {}
): PlanResult {
  const kinds = opts.kinds ?? SNAPSHOT_KINDS;
  const done = new Set(opts.checkpoint?.done ?? []);
  const gone = opts.retryGone ? new Set<string>() : new Set(opts.checkpoint?.gone ?? []);
  const requests: PlannedRequest[] = [];
  let skippedStored = 0;
  let skippedCheckpoint = 0;
  for (const kind of SNAPSHOT_KINDS) {
    if (!kinds.includes(kind)) continue;
    for (const t of targets) {
      const key = pairKey(t.stravaId, kind);
      if (opts.stored?.has(key)) skippedStored++;
      else if (done.has(key) || gone.has(key)) skippedCheckpoint++;
      else requests.push({ ...t, kind, path: snapshotEndpoint(kind, t.stravaId) });
    }
  }
  return { requests, skippedStored, skippedCheckpoint };
}

// (strava id, kind) pairs already snapshotted, from activity_sources rows
export function storedPairs(rows: { externalId: string | null; kind: string; rawSha256: string | null }[]): Set<string> {
  const out = new Set<string>();
  for (const r of rows) {
    if (r.externalId && r.rawSha256 && (SNAPSHOT_KINDS as readonly string[]).includes(r.kind)) {
      out.add(pairKey(r.externalId, r.kind));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// local checkpoint (os temp dir): survives a crash between the raw put and the
// source insert, and remembers 404s so they aren't re-fetched every run

export interface Checkpoint {
  version: 1;
  done: string[];
  gone: string[];
  updatedAt: string | null;
}

export function emptyCheckpoint(): Checkpoint {
  return { version: 1, done: [], gone: [], updatedAt: null };
}

export function parseCheckpoint(text: string | null): Checkpoint {
  if (!text) return emptyCheckpoint();
  try {
    const parsed = JSON.parse(text) as Partial<Checkpoint>;
    if (parsed.version !== 1) return emptyCheckpoint();
    const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
    return { version: 1, done: strings(parsed.done), gone: strings(parsed.gone), updatedAt: parsed.updatedAt ?? null };
  } catch {
    return emptyCheckpoint();
  }
}

export function markCheckpoint(cp: Checkpoint, key: string, outcome: "done" | "gone", now = new Date()): Checkpoint {
  const list = outcome === "done" ? cp.done : cp.gone;
  if (list.includes(key)) return cp;
  return {
    ...cp,
    done: outcome === "done" ? [...cp.done, key] : cp.done,
    gone: outcome === "gone" ? [...cp.gone, key] : cp.gone,
    updatedAt: now.toISOString(),
  };
}

// strava "Activity ID" column of an export's activities.csv
export function idsFromCsvRows(rows: Record<string, string>[]): string[] {
  return rows.map((r) => (r["Activity ID"] ?? "").trim()).filter((id) => STRAVA_ID_RE.test(id));
}
