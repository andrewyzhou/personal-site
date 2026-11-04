// pure helpers behind the cleaning admin api: track downsampling for the
// editor, split/merge planning and the guards that keep both reversible.

import { createHash } from "crypto";
import type { CanonicalTrack } from "../canonical-track";
import type { ActivityRow, NewActivityRow } from "../db/schema";
import { localDateTime } from "../activities";
import { CLEANING_EDIT_KINDS, applyCleaning, validateCleaningEdit, type EditLike } from "./edits";

// ---------------------------------------------------------------------------
// editor track

export const EDITOR_MAX_POINTS = 3000;

export interface EditorTrack {
  t: number[];
  lat: (number | null)[];
  lng: (number | null)[];
  speed: (number | null)[];
  hr: (number | null)[];
  ele: (number | null)[];
  dist: number[];
}

// indices to keep: first and last always, then per bucket the slowest and
// fastest sample (spikes survive the downsampling), in track order
export function downsampleIndices(speed: (number | null)[], max = EDITOR_MAX_POINTS): number[] {
  const n = speed.length;
  if (n <= max) return Array.from({ length: n }, (_, i) => i);
  const keep = new Set<number>([0, n - 1]);
  const buckets = Math.max(1, Math.floor((max - 2) / 2));
  const inner = n - 2;
  for (let b = 0; b < buckets; b++) {
    const lo = 1 + Math.floor((b * inner) / buckets);
    const hi = 1 + Math.floor(((b + 1) * inner) / buckets); // exclusive
    if (hi <= lo) continue;
    let minI = lo;
    let maxI = lo;
    for (let i = lo; i < hi; i++) {
      const v = speed[i];
      if (v === null) continue;
      if (speed[minI] === null || v < (speed[minI] as number)) minI = i;
      if (speed[maxI] === null || v > (speed[maxI] as number)) maxI = i;
    }
    keep.add(minI);
    // flat bucket: keep its end too, so the time resolution doesn't halve
    keep.add(maxI !== minI ? maxI : hi - 1);
  }
  return [...keep].sort((a, b) => a - b);
}

export function editorTrack(track: CanonicalTrack, max = EDITOR_MAX_POINTS): EditorTrack {
  const c = track.columns;
  const idx = downsampleIndices(c.speed, max);
  return {
    t: idx.map((i) => c.t[i]),
    lat: idx.map((i) => c.lat[i]),
    lng: idx.map((i) => c.lng[i]),
    speed: idx.map((i) => c.speed[i]),
    hr: idx.map((i) => c.hr[i]),
    ele: idx.map((i) => c.ele[i]),
    dist: idx.map((i) => c.dist[i]),
  };
}

// ---------------------------------------------------------------------------
// stat columns shown next to the routes

export const STAT_COLUMNS = [
  "distanceM", "movingTimeS", "elapsedTimeS", "elevGainM", "avgSpeedMs", "maxSpeedMs",
  "avgHr", "maxHr", "avgCadence", "avgWatts", "maxWatts", "kilojoules",
  "trimStartM", "trimEndM", "hrZonesS",
] as const;
export type StatColumn = (typeof STAT_COLUMNS)[number];

export function pickStats(src: Partial<Record<StatColumn, unknown>>): Record<StatColumn, unknown> {
  const out = {} as Record<StatColumn, unknown>;
  for (const k of STAT_COLUMNS) out[k] = src[k] ?? null;
  return out;
}

// ---------------------------------------------------------------------------
// edits

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export interface Crop {
  id: number;
  startS: number | null;
  endS: number | null;
}

// the crop window in effect: active crops intersect (latest start, earliest
// end), optionally ignoring one. id is the latest crop's. times as stored
// (the canonical clock the edits were made on)
export function currentCrop(edits: EditLike[], excludeId?: number): Crop | null {
  const crops = edits.filter((e) => e.kind === "crop" && e.id !== excludeId);
  if (!crops.length) return null;
  let startS: number | null = null;
  let endS: number | null = null;
  for (const c of crops) {
    const a = num(c.params.startS);
    const b = num(c.params.endS);
    if (a !== null) startS = startS === null ? a : Math.max(startS, a);
    if (b !== null) endS = endS === null ? b : Math.min(endS, b);
  }
  return { id: crops[crops.length - 1].id, startS, endS };
}

// a merged part's own edits: its active cleaning, minus merges and markers
export function ownCleaning(edits: EditLike[]): EditLike[] {
  return edits.filter((e) => (CLEANING_EDIT_KINDS as readonly string[]).includes(e.kind) && e.kind !== "merge");
}

const TIMED_KINDS = ["crop", "cut", "drop-points"];

// new crop/cut/drop-points times are on the current canonical clock; the
// anchor records that clock's start so they land in the same place later
export function withAnchor(kind: string, params: Record<string, unknown>, startEpochMs: number | null): Record<string, unknown> {
  if (startEpochMs === null || !TIMED_KINDS.includes(kind)) return params;
  return { ...params, anchorEpochMs: startEpochMs };
}

export const NO_TIMED_TRACK = "this activity has no timed track (route only)";

// route-only tracks have made-up timestamps: nothing time-based applies
export function syntheticRefusal(track: Pick<CanonicalTrack, "syntheticTime"> | null): Refusal | null {
  return track?.syntheticTime ? { ok: false, status: 422, error: NO_TIMED_TRACK } : null;
}

// ---------------------------------------------------------------------------
// split boundaries

export interface SplitBounds {
  maxS: number | null; // parent of a live split: nothing after this
  minS: number | null; // live split half: nothing before this
}

// live split markers: the parent's own (its child takes everything after
// atS) and, for a child, its parent's marker for it
export function splitBounds(activityId: number, edits: EditLike[], parentEdits: EditLike[] | null): SplitBounds {
  const own = edits.filter((e) => e.kind === "split").map((e) => num(e.params.atS)).filter((v): v is number => v !== null);
  const mine = (parentEdits ?? []).find((e) => e.kind === "split" && Number(e.params.childId) === activityId);
  return {
    maxS: own.length ? Math.min(...own) : null,
    minS: mine ? num(mine.params.atS) : null,
  };
}

// a crop or cut must stay on its own side of a live split
export function boundaryRefusal(edit: { kind: string; params: Record<string, unknown> }, b: SplitBounds): Refusal | null {
  if (b.maxS === null && b.minS === null) return null;
  const p = edit.params;
  const lo = edit.kind === "crop" ? num(p.startS) : edit.kind === "cut" ? num(p.fromS) : null;
  const hi = edit.kind === "crop" ? num(p.endS) : edit.kind === "cut" ? num(p.toS) : null;
  if (b.maxS !== null && ((lo !== null && lo >= b.maxS) || (hi !== null && hi > b.maxS))) {
    return { ok: false, status: 409, error: `this activity was split at ${b.maxS} s — nothing after that belongs to it (undo the split first)` };
  }
  if (b.minS !== null && ((lo !== null && lo < b.minS) || (hi !== null && hi <= b.minS))) {
    return { ok: false, status: 409, error: `this activity starts at the split (${b.minS} s) — nothing before that belongs to it (undo the split first)` };
  }
  return null;
}

export function latestOf(edits: EditLike[], kind: string): EditLike | null {
  const list = edits.filter((e) => e.kind === kind);
  return list[list.length - 1] ?? null;
}

// time range of the cleaned track (merges ignored), null when nothing is left
export function cleanedRange(track: CanonicalTrack, edits: EditLike[]): { startS: number; endS: number } | null {
  const t = applyCleaning(track, edits).track.columns.t;
  return t.length >= 2 ? { startS: t[0], endS: t[t.length - 1] } : null;
}

// ---------------------------------------------------------------------------
// request bodies

// kinds the generic edits route records (merge and split have their own)
export const DIRECT_EDIT_KINDS = ["crop", "cut", "drop-points", "no-gps"] as const;

export function parseEditBody(
  kind: unknown,
  params: unknown,
  allowed: readonly string[]
): { kind: string; params: Record<string, unknown> } | string {
  if (typeof kind !== "string" || !kind) return "kind required";
  if (!allowed.includes(kind)) return `unsupported kind ${kind}`;
  if (params !== undefined && (typeof params !== "object" || params === null || Array.isArray(params))) return "params must be an object";
  const v = validateCleaningEdit(kind, params ?? {});
  return v.ok ? { kind, params: v.params } : v.error;
}

export const MAX_PROPOSED = 50;

// preview body: synthetic negative ids never collide with stored ones
export function parseProposedEdits(raw: unknown): EditLike[] | string {
  if (!Array.isArray(raw) || raw.length > MAX_PROPOSED) return `edits must be an array of at most ${MAX_PROPOSED}`;
  const out: EditLike[] = [];
  for (let i = 0; i < raw.length; i++) {
    const e = raw[i] as { kind?: unknown; params?: unknown } | null;
    if (!e || typeof e !== "object" || Array.isArray(e)) return `edits[${i}]: must be an object`;
    const parsed = parseEditBody(e.kind, e.params, CLEANING_EDIT_KINDS);
    if (typeof parsed === "string") return `edits[${i}]: ${parsed}`;
    out.push({ id: -(i + 1), ...parsed });
  }
  return out;
}

// ---------------------------------------------------------------------------
// split

export function splitDedupeKey(parentKey: string, atS: number): string {
  return createHash("sha256").update(`${parentKey}:split:${atS}`).digest("hex");
}

export function parseAtS(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : null;
}

type ParentForChild = Pick<
  ActivityRow,
  "id" | "name" | "sportType" | "gear" | "source" | "startDateUtc" | "utcOffsetMin" | "dedupeKey" |
  "fitBlobUrl" | "fitBlobPathname" | "fitSha256" | "fileType" | "hidden" | "mapHidden" | "hrHidden" |
  "trimStartM" | "trimEndM"
>;

// the second half: same metadata, no external id, its own dedupe key. the
// route stays withheld until republish; processing_version is current so the
// legacy-trim fallback never applies to it (its trim is copied explicitly)
export function childValues(parent: ParentForChild, atS: number, processingVersion: number): NewActivityRow {
  const startDateUtc = new Date(parent.startDateUtc.getTime() + atS * 1000);
  const { localDate, localTime } = localDateTime(startDateUtc, parent.utcOffsetMin);
  return {
    name: `${parent.name} (2)`,
    sportType: parent.sportType,
    gear: parent.gear,
    description: null,
    source: parent.source,
    externalId: null,
    startDateUtc,
    localDate,
    localTime,
    utcOffsetMin: parent.utcOffsetMin,
    dedupeKey: splitDedupeKey(parent.dedupeKey, atS),
    fitBlobUrl: parent.fitBlobUrl,
    fitBlobPathname: parent.fitBlobPathname,
    fitSha256: parent.fitSha256,
    fileType: parent.fileType,
    trimStartM: parent.trimStartM,
    trimEndM: parent.trimEndM,
    hidden: parent.hidden,
    mapHidden: parent.mapHidden,
    hrHidden: parent.hrHidden,
    splitFromId: parent.id,
    processingVersion,
    needsRepublish: true,
    staleMarkedAt: new Date(),
  };
}

// crops a split at atS creates. crops intersect, so the parent only needs
// its new end (its earlier crops keep applying); the child starts with no
// crops of its own, so it gets atS plus the end of the parent's window
export function splitCrops(prior: Crop | null, atS: number) {
  return {
    parent: { startS: null, endS: atS },
    child: { startS: atS, endS: prior?.endS ?? null },
  };
}

// the parent crop an interrupted split left behind (end at atS, no start)
export function findSplitCrop(edits: EditLike[], atS: number): EditLike | null {
  const list = edits.filter((e) => e.kind === "crop" && num(e.params.startS) === null && num(e.params.endS) === atS);
  return list[list.length - 1] ?? null;
}

export type Refusal = { ok: false; status: number; error: string };

// what a split needs before it may run (atS checked against the range separately)
export function splitRefusal(parentEdits: EditLike[]): Refusal | null {
  if (parentEdits.some((e) => e.kind === "merge")) return { ok: false, status: 409, error: "activity has merges — undo them before splitting" };
  if (parentEdits.some((e) => e.kind === "merged-into")) return { ok: false, status: 409, error: "activity is merged into another" };
  return null;
}

export function atSInside(range: { startS: number; endS: number } | null, atS: number): boolean {
  return range !== null && atS > range.startS && atS < range.endS;
}

// ---------------------------------------------------------------------------
// merge

export const MERGE_WINDOW_MS = 12 * 3600 * 1000;

type MergeSide = {
  row: Pick<ActivityRow, "id" | "startDateUtc" | "splitFromId" | "hidden" | "mapHidden" | "hrHidden">;
  edits: EditLike[];
  syntheticTime?: boolean; // canonical track is route only
};

export type MergePlan =
  | Refusal
  | { ok: true; targetId: number; absorbedId: number; alreadyMerged: boolean; markerId: number | null; mergeEditId: number | null };

const mergedInto = (edits: EditLike[]) => edits.find((e) => e.kind === "merged-into") ?? null;

// what a fresh merge needs: nothing private shown through the target, no
// split halves, timed tracks on both sides, and no crop cutting the joint
function mergeGuards(target: MergeSide, absorbed: MergeSide): Refusal | null {
  const t = target.row;
  const a = absorbed.row;
  if (target.syntheticTime || absorbed.syntheticTime) {
    const which = target.syntheticTime ? t.id : a.id;
    return { ok: false, status: 422, error: `activity ${which}: ${NO_TIMED_TRACK}` };
  }
  if (a.hidden) return { ok: false, status: 409, error: `activity ${a.id} is private — merging would publish it through #${t.id}` };
  if (a.mapHidden && !t.mapHidden) return { ok: false, status: 409, error: `activity ${a.id} hides its map but #${t.id} doesn't — merging would show its route` };
  if (a.hrHidden && !t.hrHidden) return { ok: false, status: 409, error: `activity ${a.id} hides heart rate but #${t.id} doesn't — merging would show it` };
  for (const s of [target, absorbed]) {
    if (s.row.splitFromId) return { ok: false, status: 409, error: `activity ${s.row.id} is a split half — undo the split first` };
    if (s.edits.some((e) => e.kind === "split")) return { ok: false, status: 409, error: `activity ${s.row.id} was split — undo the split first` };
  }
  const tc = currentCrop(target.edits);
  if (tc?.endS !== null && tc?.endS !== undefined) {
    return { ok: false, status: 409, error: `activity ${t.id} has its end cropped — undo the crop first, or merge before cropping` };
  }
  const ac = currentCrop(absorbed.edits);
  if (ac?.startS !== null && ac?.startS !== undefined) {
    return { ok: false, status: 409, error: `activity ${a.id} has its start cropped — undo the crop first, or merge before cropping` };
  }
  return null;
}

// later-starting activity goes into the earlier one; no chains, no cycles,
// nothing merged twice. a half-finished merge into the same target resumes.
export function planMerge(a: MergeSide, b: MergeSide): MergePlan {
  if (a.row.id === b.row.id) return { ok: false, status: 400, error: "can't merge an activity into itself" };
  const [target, absorbed] = b.row.startDateUtc.getTime() < a.row.startDateUtc.getTime() ? [b, a] : [a, b];
  if (Math.abs(absorbed.row.startDateUtc.getTime() - target.row.startDateUtc.getTime()) > MERGE_WINDOW_MS) {
    return { ok: false, status: 400, error: "activities must start within 12 h of each other" };
  }
  if (target.row.splitFromId === absorbed.row.id || absorbed.row.splitFromId === target.row.id) {
    return { ok: false, status: 409, error: "these were split from each other — undo the split instead" };
  }
  if (mergedInto(target.edits)) return { ok: false, status: 409, error: `activity ${target.row.id} is itself merged into another` };
  if (absorbed.edits.some((e) => e.kind === "merge")) {
    return { ok: false, status: 409, error: `activity ${absorbed.row.id} has activities merged into it` };
  }
  const marker = mergedInto(absorbed.edits);
  if (marker && Number(marker.params.intoActivityId) !== target.row.id) {
    return { ok: false, status: 409, error: `activity ${absorbed.row.id} is already merged into ${marker.params.intoActivityId}` };
  }
  // a half-finished merge into this target already passed these
  if (!marker) {
    const refusal = mergeGuards(target, absorbed);
    if (refusal) return refusal;
  }
  const mergeEdit = target.edits.find((e) => e.kind === "merge" && Number(e.params.withActivityId) === absorbed.row.id) ?? null;
  return {
    ok: true,
    targetId: target.row.id,
    absorbedId: absorbed.row.id,
    alreadyMerged: marker !== null && mergeEdit !== null,
    markerId: marker?.id ?? null,
    mergeEditId: mergeEdit?.id ?? null,
  };
}

// ---------------------------------------------------------------------------
// revert guards

// a crop a live split depends on can only go away with the split itself
export function revertRefusal(
  edit: EditLike,
  activityEdits: EditLike[],
  opts: { isSplitChild: boolean; splitAtS?: number | null }
): Refusal | null {
  if (edit.kind === "crop") {
    const marker = activityEdits.find((e) => e.kind === "split" && Number(e.params.parentCropEditId) === edit.id);
    if (marker) return { ok: false, status: 409, error: "this crop belongs to a split — undo the split instead" };
    if (opts.isSplitChild) {
      // the half must still start at (or after) the split without this crop
      const rest = currentCrop(activityEdits.filter((e) => e.id !== edit.id));
      const atS = opts.splitAtS ?? null;
      const covered = rest !== null && rest.startS !== null && (atS === null || rest.startS >= atS);
      if (!covered) return { ok: false, status: 409, error: "the split half needs a crop — undo the split on the original instead" };
    }
  }
  return null;
}

// a split half that absorbed another activity can't be folded back yet
export function splitRevertRefusal(childEdits: EditLike[]): Refusal | null {
  if (childEdits.some((e) => e.kind === "merge")) {
    return { ok: false, status: 409, error: "the split half has an activity merged into it — undo that merge first" };
  }
  return null;
}
