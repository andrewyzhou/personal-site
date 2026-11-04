// pure helpers for the admin clean page: time labels, scrubber math,
// downsampling to pixels, edit/suggestion grouping and stat rows. no dom, no
// fetch, so everything here is unit tested.

import { DURATION_ONLY_TYPES, PACE_TYPES, formatClockDuration, formatFeet, formatMiles, formatMph, formatPace } from "../activity-format";

// ---- time ----

// offset from the first sample: m:ss, or h:mm:ss past an hour
export function fmtOffset(s: number): string {
  if (!Number.isFinite(s)) return "—";
  return formatClockDuration(Math.max(0, s));
}

// wall clock at an offset, in the activity's own timezone: "7:12:05 am"
export function fmtClock(startEpochMs: number, s: number, utcOffsetMin = 0): string {
  if (!Number.isFinite(startEpochMs) || !Number.isFinite(s)) return "—";
  const d = new Date(startEpochMs + s * 1000 + utcOffsetMin * 60_000);
  let h = d.getUTCHours();
  const ampm = h >= 12 ? "pm" : "am";
  h = h % 12 === 0 ? 12 : h % 12;
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  return `${h}:${mm}:${ss} ${ampm}`;
}

export interface TimeCtx {
  startEpochMs: number;
  utcOffsetMin: number;
}

// "12:40 (7:52:40 am)"
export function fmtAt(s: number, ctx: TimeCtx): string {
  return `${fmtOffset(s)} (${fmtClock(ctx.startEpochMs, s, ctx.utcOffsetMin)})`;
}

export function fmtRange(fromS: number, toS: number, ctx: TimeCtx): string {
  return `${fmtOffset(fromS)}–${fmtOffset(toS)} (${fmtClock(ctx.startEpochMs, fromS, ctx.utcOffsetMin)}–${fmtClock(ctx.startEpochMs, toS, ctx.utcOffsetMin)})`;
}

export function fmtConfidence(c: number): string {
  return Number.isFinite(c) ? `${Math.round(Math.max(0, Math.min(1, c)) * 100)}%` : "—";
}

// ---- scrubber / selection math ----

export const clampTime = (s: number, duration: number) => Math.max(0, Math.min(duration, s));

export function xToTime(x: number, width: number, duration: number): number {
  if (width <= 0 || duration <= 0) return 0;
  return clampTime((x / width) * duration, duration);
}

export function timeToX(s: number, width: number, duration: number): number {
  if (duration <= 0) return 0;
  return (clampTime(s, duration) / duration) * width;
}

export interface Range {
  fromS: number;
  toS: number;
}

// ordered, clamped, rounded to whole seconds; null when too narrow to act on
export function normalizeRange(a: number, b: number, duration: number, minS = 1): Range | null {
  const lo = Math.round(clampTime(Math.min(a, b), duration));
  const hi = Math.round(clampTime(Math.max(a, b), duration));
  return hi - lo >= minS ? { fromS: lo, toS: hi } : null;
}

// keyboard step: ~1/500 of the track, at least a second; shift is 10x
export function nudgeStep(duration: number, big = false): number {
  const base = Math.max(1, Math.round(duration / 500));
  return big ? base * 10 : base;
}

export function nudge(s: number, delta: number, duration: number): number {
  return clampTime(Math.round(s + delta), duration);
}

// index of the sample nearest to s (t sorted ascending)
export function nearestIndex(t: number[], s: number): number {
  if (t.length === 0) return -1;
  let lo = 0;
  let hi = t.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (t[mid] < s) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(t[lo - 1] - s) <= Math.abs(t[lo] - s)) return lo - 1;
  return lo;
}

export interface TrackCols {
  t: number[];
  lat: (number | null)[];
  lng: (number | null)[];
}

// [lat, lng] nearest in time to s that has a position
export function positionAt(track: TrackCols, s: number): [number, number] | null {
  const i = nearestIndex(track.t, s);
  if (i < 0) return null;
  for (let d = 0; d < track.t.length; d++) {
    for (const j of d === 0 ? [i] : [i - d, i + d]) {
      if (j < 0 || j >= track.t.length) continue;
      const la = track.lat[j];
      const ln = track.lng[j];
      if (la !== null && ln !== null && Number.isFinite(la) && Number.isFinite(ln)) return [la, ln];
    }
  }
  return null;
}

// [lat, lng] runs inside [fromS, toS], broken wherever positions are missing
export function segmentsInRange(track: TrackCols, fromS = -Infinity, toS = Infinity): [number, number][][] {
  const out: [number, number][][] = [];
  let run: [number, number][] = [];
  for (let i = 0; i < track.t.length; i++) {
    const t = track.t[i];
    if (t < fromS || t > toS) continue;
    const la = track.lat[i];
    const ln = track.lng[i];
    if (la === null || ln === null || !Number.isFinite(la) || !Number.isFinite(ln)) {
      if (run.length) out.push(run);
      run = [];
      continue;
    }
    run.push([la, ln]);
  }
  if (run.length) out.push(run);
  return out;
}

export interface Bounds {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
}

export function boundsOfSegments(segments: [number, number][][]): Bounds | null {
  let minLat = Infinity, minLng = Infinity, maxLat = -Infinity, maxLng = -Infinity;
  for (const seg of segments) {
    for (const [la, ln] of seg) {
      minLat = Math.min(minLat, la);
      maxLat = Math.max(maxLat, la);
      minLng = Math.min(minLng, ln);
      maxLng = Math.max(maxLng, ln);
    }
  }
  return Number.isFinite(minLat) ? { minLat, minLng, maxLat, maxLng } : null;
}

// ---- downsample to pixels ----

export interface Bucket {
  min: number;
  max: number;
  avg: number;
}

// one bucket per pixel column over the time axis; null where no sample lands
export function bucketSeries(t: number[], v: (number | null)[], duration: number, width: number): (Bucket | null)[] {
  const w = Math.max(0, Math.floor(width));
  const sums = new Array<number>(w).fill(0);
  const counts = new Array<number>(w).fill(0);
  const mins = new Array<number>(w).fill(Infinity);
  const maxs = new Array<number>(w).fill(-Infinity);
  if (w === 0 || duration <= 0) return [];
  for (let i = 0; i < t.length; i++) {
    const val = v[i];
    if (val === null || val === undefined || !Number.isFinite(val)) continue;
    const px = Math.min(w - 1, Math.max(0, Math.floor((t[i] / duration) * w)));
    sums[px] += val;
    counts[px]++;
    if (val < mins[px]) mins[px] = val;
    if (val > maxs[px]) maxs[px] = val;
  }
  return counts.map((c, px) => (c ? { min: mins[px], max: maxs[px], avg: sums[px] / c } : null));
}

export function hasValues(v: (number | null)[] | undefined): boolean {
  return !!v && v.some((x) => x !== null && Number.isFinite(x));
}

// value range for a chart, ignoring the top/bottom 1% (spikes)
export function robustRange(v: (number | null)[]): [number, number] | null {
  const xs = v.filter((x): x is number => x !== null && Number.isFinite(x)).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const at = (q: number) => xs[Math.min(xs.length - 1, Math.max(0, Math.round(q * (xs.length - 1))))];
  const lo = at(0.01);
  const hi = at(0.99);
  return hi > lo ? [lo, hi] : [lo - 1, lo + 1];
}

// svg path through bucket averages (gaps joined), y scaled into [0, height]
export function linePath(buckets: (Bucket | null)[], height: number, lo: number, hi: number, pad = 2): string {
  const span = hi - lo || 1;
  const y = (v: number) => {
    const f = Math.max(0, Math.min(1, (v - lo) / span));
    return (height - pad - f * (height - 2 * pad)).toFixed(1);
  };
  let d = "";
  buckets.forEach((b, px) => {
    if (!b) return;
    d += `${d ? "L" : "M"}${px + 0.5},${y(b.avg)}`;
  });
  return d;
}

// filled area under the bucket maxima, down to the baseline
export function areaPath(buckets: (Bucket | null)[], height: number, hi: number, pad = 2): string {
  const pts: string[] = [];
  let first = -1;
  let last = -1;
  buckets.forEach((b, px) => {
    if (!b) return;
    if (first < 0) first = px;
    last = px;
    const f = Math.max(0, Math.min(1, b.max / (hi || 1)));
    pts.push(`${px + 0.5},${(height - f * (height - pad)).toFixed(1)}`);
  });
  if (pts.length === 0) return "";
  return `M${first + 0.5},${height}L${pts.join("L")}L${last + 0.5},${height}Z`;
}

// evenly spaced axis ticks at round-ish second values
export function axisTicks(duration: number, count = 5): number[] {
  if (duration <= 0) return [0];
  const raw = duration / count;
  const steps = [10, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 10800];
  const step = steps.find((s) => s >= raw) ?? Math.ceil(raw / 3600) * 3600;
  const out: number[] = [];
  for (let s = 0; s <= duration; s += step) out.push(s);
  return out;
}

// ---- edits ----

export const CLEANING_KINDS = ["crop", "cut", "drop-points", "no-gps", "merge"] as const;
export const MARKER_KINDS = ["split", "merged-into"] as const;

export interface EditRow {
  id: number;
  kind: string;
  params: Record<string, unknown>;
  note: string | null;
  createdAt: string;
  revertedAt: string | null;
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const time = (s: string) => {
  const n = Date.parse(s);
  return Number.isFinite(n) ? n : 0;
};

export function isRevertable(e: EditRow): boolean {
  return !e.revertedAt && (CLEANING_KINDS as readonly string[]).includes(e.kind);
}

export function newestFirst<T extends { id: number; createdAt: string }>(edits: T[]): T[] {
  return [...edits].sort((a, b) => time(b.createdAt) - time(a.createdAt) || b.id - a.id);
}

// the crop republish applies: latest active one wins
export function currentCrop(edits: EditRow[]): { startS: number | null; endS: number | null } | null {
  const crop = newestFirst(edits).find((e) => e.kind === "crop" && !e.revertedAt);
  if (!crop) return null;
  return { startS: isNum(crop.params.startS) ? crop.params.startS : null, endS: isNum(crop.params.endS) ? crop.params.endS : null };
}

// trim one side at s, keeping the other side of any current crop
export function trimParams(
  current: { startS: number | null; endS: number | null } | null,
  side: "start" | "end",
  s: number
): { startS: number | null; endS: number | null } {
  const at = Math.round(s);
  if (side === "start") {
    const endS = current?.endS ?? null;
    return { startS: at, endS: endS !== null && endS > at ? endS : null };
  }
  const startS = current?.startS ?? null;
  return { startS: startS !== null && startS < at ? startS : null, endS: at };
}

export interface Band extends Range {
  kind: "crop" | "cut";
}

// stretches the active edits remove, for drawing on the scrubber
export function removedBands(edits: EditRow[], duration: number): Band[] {
  const out: Band[] = [];
  const crop = currentCrop(edits);
  if (crop?.startS !== null && crop?.startS !== undefined && crop.startS > 0) out.push({ kind: "crop", fromS: 0, toS: Math.min(crop.startS, duration) });
  if (crop?.endS !== null && crop?.endS !== undefined && crop.endS < duration) out.push({ kind: "crop", fromS: crop.endS, toS: duration });
  for (const e of edits) {
    if (e.kind !== "cut" || e.revertedAt) continue;
    if (isNum(e.params.fromS) && isNum(e.params.toS)) out.push({ kind: "cut", fromS: e.params.fromS, toS: e.params.toS });
  }
  return out;
}

const KIND_LABELS: Record<string, string> = {
  crop: "crop",
  cut: "cut",
  "drop-points": "drop points",
  "no-gps": "drop gps",
  merge: "merge",
  split: "split",
  "merged-into": "merged into",
};

export function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind;
}

// human-readable params for the history list
export function editParamsLabel(kind: string, params: Record<string, unknown>, ctx: TimeCtx): string {
  const p = params ?? {};
  switch (kind) {
    case "crop": {
      const a = isNum(p.startS) ? p.startS : null;
      const b = isNum(p.endS) ? p.endS : null;
      if (a !== null && b !== null) return `keep ${fmtRange(a, b, ctx)}`;
      if (a !== null) return `keep from ${fmtAt(a, ctx)}`;
      if (b !== null) return `keep until ${fmtAt(b, ctx)}`;
      return "keep everything";
    }
    case "cut":
      return isNum(p.fromS) && isNum(p.toS) ? `remove ${fmtRange(p.fromS, p.toS, ctx)}` : "remove a stretch";
    case "drop-points": {
      const ts = Array.isArray(p.ts) ? (p.ts as unknown[]).filter(isNum) : [];
      const shown = ts.slice(0, 3).map(fmtOffset).join(", ");
      return `drop ${ts.length} point${ts.length === 1 ? "" : "s"}${ts.length ? ` at ${shown}${ts.length > 3 ? ", …" : ""}` : ""}`;
    }
    case "no-gps":
      return "drop all positions";
    case "merge":
      return `appended activity #${p.withActivityId}`;
    case "split":
      return isNum(p.atS) ? `split at ${fmtAt(p.atS, ctx)} into #${p.childId}` : `split into #${p.childId}`;
    case "merged-into":
      return `merged into #${p.intoActivityId}`;
    default:
      return JSON.stringify(p);
  }
}

// related activity an edit points at (split child, merge source, merge target)
export function editLinkId(kind: string, params: Record<string, unknown>): number | null {
  const v = kind === "split" ? params?.childId : kind === "merge" ? params?.withActivityId : kind === "merged-into" ? params?.intoActivityId : null;
  return Number.isInteger(v) && (v as number) > 0 ? (v as number) : null;
}

// ---- suggestions ----

export interface SuggestionRow {
  id: number;
  kind: string;
  confidence: number;
  summary: string;
  range: Range | null;
  edit: { kind: string; params: Record<string, unknown> } | null;
  status: "open" | "accepted" | "dismissed";
  editId: number | null;
}

// open actionable ones by confidence; closed ones; info-only stops by time
export function groupSuggestions<T extends SuggestionRow>(list: T[]): { open: T[]; closed: T[]; stops: T[] } {
  const stops = list.filter((s) => s.kind === "idle" || !s.edit).sort((a, b) => (a.range?.fromS ?? 0) - (b.range?.fromS ?? 0));
  const rest = list.filter((s) => !(s.kind === "idle" || !s.edit));
  const open = rest.filter((s) => s.status === "open").sort((a, b) => b.confidence - a.confidence);
  const closed = rest.filter((s) => s.status !== "open");
  return { open, closed, stops };
}

// ---- stats ----

export interface StatsLike {
  distanceM: number | null;
  movingTimeS: number | null;
  elapsedTimeS: number | null;
  elevGainM: number | null;
  avgSpeedMs: number | null;
  avgHr: number | null;
  maxHr: number | null;
}

export interface StatRow {
  label: string;
  values: string[];
}

const dash = "—";
const fmtNum = (v: number | null | undefined, f: (n: number) => string) => (v === null || v === undefined || !Number.isFinite(v) ? dash : f(v));

// rows for the raw / published / preview columns; null columns print dashes
export function statRows(sportType: string, cols: (StatsLike | null)[]): StatRow[] {
  const durationOnly = DURATION_ONLY_TYPES.has(sportType);
  const pace = PACE_TYPES.has(sportType);
  const rows: StatRow[] = [];
  const row = (label: string, f: (s: StatsLike) => string) => rows.push({ label, values: cols.map((c) => (c ? f(c) : dash)) });
  if (!durationOnly) row("distance", (s) => fmtNum(s.distanceM, formatMiles));
  row("moving", (s) => fmtNum(s.movingTimeS, formatClockDuration));
  row("elapsed", (s) => fmtNum(s.elapsedTimeS, formatClockDuration));
  if (!durationOnly) {
    row(pace ? "pace" : "speed", (s) => fmtNum(s.avgSpeedMs, pace ? formatPace : formatMph));
    row("elevation", (s) => fmtNum(s.elevGainM, formatFeet));
  }
  row("avg hr", (s) => fmtNum(s.avgHr, (n) => `${Math.round(n)} bpm`));
  row("max hr", (s) => fmtNum(s.maxHr, (n) => `${Math.round(n)} bpm`));
  return rows;
}

// seconds per zone → fractions of the total; null when there's nothing
export function zoneFractions(zones: number[] | null | undefined): number[] | null {
  if (!Array.isArray(zones) || zones.length === 0) return null;
  const clean = zones.map((z) => (Number.isFinite(z) && z > 0 ? z : 0));
  const total = clean.reduce((a, b) => a + b, 0);
  return total > 0 ? clean.map((z) => z / total) : null;
}

// ---- settings ----

export interface ActivitySettingsShape {
  autoApply: { enabled: boolean; minConfidence: number };
  hrMaxBpm: number;
  hrZonePcts: number[];
}

export interface SettingsForm {
  enabled: boolean;
  minConfidencePct: string;
  hrMaxBpm: string;
  zonePcts: string[]; // percent of max, e.g. "60"
}

export function settingsToForm(s: ActivitySettingsShape): SettingsForm {
  return {
    enabled: s.autoApply.enabled,
    minConfidencePct: String(Math.round(s.autoApply.minConfidence * 100)),
    hrMaxBpm: String(s.hrMaxBpm),
    zonePcts: s.hrZonePcts.map((p) => String(Math.round(p * 100))),
  };
}

// same bounds the server normalizes to
export function formToSettings(f: SettingsForm): { ok: true; settings: ActivitySettingsShape } | { ok: false; error: string } {
  const conf = Number(f.minConfidencePct);
  if (!Number.isFinite(conf) || conf < 50 || conf > 100) return { ok: false, error: "min confidence must be 50–100%" };
  const hr = Number(f.hrMaxBpm);
  if (!Number.isInteger(hr) || hr < 120 || hr > 230) return { ok: false, error: "max hr must be 120–230 bpm" };
  if (f.zonePcts.length !== 4) return { ok: false, error: "need four zone bounds" };
  const pcts = f.zonePcts.map(Number);
  for (let i = 0; i < 4; i++) {
    if (!Number.isFinite(pcts[i]) || pcts[i] <= 30 || pcts[i] >= 100) return { ok: false, error: "zone bounds must be between 30% and 100%" };
    if (i > 0 && pcts[i] <= pcts[i - 1]) return { ok: false, error: "zone bounds must increase" };
  }
  return {
    ok: true,
    settings: { autoApply: { enabled: f.enabled, minConfidence: conf / 100 }, hrMaxBpm: hr, hrZonePcts: pcts.map((p) => p / 100) },
  };
}

// zone bounds in bpm for the settings hint
export function zoneBpm(hrMaxBpm: number, pcts: number[]): number[] {
  return pcts.map((p) => Math.round(hrMaxBpm * p));
}
