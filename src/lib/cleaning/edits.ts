// cleaning edits: declarative intent stored in activity_edits, applied by
// republish to a COPY of the canonical track (raw and canonical never change).
// every edit is reversible by reverting its row.
//
//   crop         { startS: number|null, endS: number|null }  keep only this time window (latest wins)
//   cut          { fromS, toS }                              remove a middle stretch (any number)
//   drop-points  { ts: number[] }                            remove single samples (gps spikes)
//   no-gps       {}                                          drop all positions (indoor drift)
//   merge        { withActivityId }                          append another activity's track
//   split        { childId, atS }                            marker: this activity was split (its crop carries the effect)
//   merged-into  { intoActivityId, wasHidden }               marker on an activity merged into another
//
// times are seconds on the canonical track's own clock (t of the first sample = 0).

import { haversineM } from "../geo";
import type { CanonicalTrack } from "../canonical-track";

export const CLEANING_EDIT_KINDS = ["crop", "cut", "drop-points", "no-gps", "merge"] as const;
export const MARKER_EDIT_KINDS = ["split", "merged-into"] as const;
export type CleaningEditKind = (typeof CLEANING_EDIT_KINDS)[number];

export interface EditLike {
  id: number;
  kind: string;
  params: Record<string, unknown>;
}

const MAX_DROP_POINTS = 20000;

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export type ValidatedParams = { ok: true; params: Record<string, unknown> } | { ok: false; error: string };

// times in crop/cut/drop-points are on the clock of the track they were made
// on; anchorEpochMs records that track's start so they still land in the same
// place if a better source (different first sample) replaces it later
function anchorOf(p: Record<string, unknown>): { anchorEpochMs?: number } {
  return isNum(p.anchorEpochMs) && p.anchorEpochMs > 0 ? { anchorEpochMs: Math.round(p.anchorEpochMs) } : {};
}

// strict validation for anything that reaches activity_edits through the api
export function validateCleaningEdit(kind: string, params: unknown): ValidatedParams {
  const p = (params && typeof params === "object" ? params : {}) as Record<string, unknown>;
  switch (kind) {
    case "crop": {
      const startS = p.startS === null || p.startS === undefined ? null : p.startS;
      const endS = p.endS === null || p.endS === undefined ? null : p.endS;
      if (startS !== null && (!isNum(startS) || startS < 0)) return { ok: false, error: "startS must be a number ≥ 0 or null" };
      if (endS !== null && (!isNum(endS) || endS <= 0)) return { ok: false, error: "endS must be a number > 0 or null" };
      if (startS !== null && endS !== null && endS <= startS) return { ok: false, error: "endS must be after startS" };
      if (startS === null && endS === null) return { ok: false, error: "crop needs startS or endS" };
      return { ok: true, params: { startS, endS, ...anchorOf(p) } };
    }
    case "cut": {
      if (!isNum(p.fromS) || !isNum(p.toS) || p.fromS < 0 || p.toS <= p.fromS) return { ok: false, error: "cut needs 0 ≤ fromS < toS" };
      return { ok: true, params: { fromS: p.fromS, toS: p.toS, ...anchorOf(p) } };
    }
    case "drop-points": {
      if (!Array.isArray(p.ts) || p.ts.length === 0 || p.ts.length > MAX_DROP_POINTS || !p.ts.every(isNum)) {
        return { ok: false, error: `drop-points needs ts: 1..${MAX_DROP_POINTS} numbers` };
      }
      return { ok: true, params: { ts: [...new Set(p.ts as number[])].sort((a, b) => a - b), ...anchorOf(p) } };
    }
    case "no-gps":
      return { ok: true, params: {} };
    case "merge": {
      if (!Number.isInteger(p.withActivityId) || (p.withActivityId as number) <= 0) return { ok: false, error: "merge needs withActivityId" };
      return { ok: true, params: { withActivityId: p.withActivityId } };
    }
    default:
      return { ok: false, error: `unknown cleaning edit kind ${kind}` };
  }
}

// crops intersect (see effectiveCropWindow), so a one-sided crop such as an
// accepted "crop the tail" already keeps any earlier head crop and can never
// widen the window past a split boundary: the proposal is stored as is
export function combineCrop(_edits: EditLike[], proposed: Record<string, unknown>): Record<string, unknown> {
  return proposed;
}

export function hasCleaning(edits: EditLike[]): boolean {
  return edits.some((e) => (CLEANING_EDIT_KINDS as readonly string[]).includes(e.kind));
}

export function mergeTargets(edits: EditLike[]): number[] {
  return edits.filter((e) => e.kind === "merge").map((e) => Number(e.params.withActivityId)).filter((n) => Number.isInteger(n) && n > 0);
}

export interface CleanedTrack {
  track: CanonicalTrack; // a new object; the input is never modified
  breaks: boolean[]; // true = discontinuity right before this sample (cut, merge gap)
  excludedS: number; // time inside discontinuities (not part of elapsed)
  cleaned: boolean;
}

export interface MergedPart {
  track: CanonicalTrack;
  edits: EditLike[]; // the absorbed activity's own active edits
}

// seconds to add to an edit's times to put them on this track's clock
function shiftFor(e: EditLike, track: CanonicalTrack): number {
  const a = e.params.anchorEpochMs;
  return isNum(a) ? (a - track.startEpochMs) / 1000 : 0;
}

// the crop window in effect: every active crop intersects (a crop can only
// narrow; widening means reverting one), on this track's clock
export function effectiveCropWindow(edits: EditLike[], track?: CanonicalTrack): { lo: number; hi: number } {
  let lo = -Infinity;
  let hi = Infinity;
  for (const e of edits) {
    if (e.kind !== "crop") continue;
    const sh = track ? shiftFor(e, track) : 0;
    if (isNum(e.params.startS)) lo = Math.max(lo, e.params.startS + sh);
    if (isNum(e.params.endS)) hi = Math.min(hi, e.params.endS + sh);
  }
  return { lo, hi };
}

type Sample = {
  t: number; lat: number | null; lng: number | null; ele: number | null; hr: number | null;
  cadence: number | null; watts: number | null; speed: number | null; dist: number; brk: boolean;
};

// one recording with its own edits applied, on its own clock. distance
// deltas skip discontinuities; spikes are re-measured (device distance
// channels don't include them, gps-derived ones do)
function cleanPart(track: CanonicalTrack, edits: EditLike[]): { samples: Sample[]; excludedS: number } {
  const deviceDist = track.source.fileType === "fit" || track.source.kind === "strava-streams";
  const { lo, hi } = effectiveCropWindow(edits, track);
  const cuts = edits
    .filter((e) => e.kind === "cut")
    .map((e) => [Number(e.params.fromS) + shiftFor(e, track), Number(e.params.toS) + shiftFor(e, track)] as const);
  const dropped = new Set<number>();
  for (const e of edits) {
    if (e.kind !== "drop-points" || !Array.isArray(e.params.ts)) continue;
    const sh = shiftFor(e, track);
    for (const t of e.params.ts as number[]) dropped.add(Math.round(t + sh));
  }
  const noGps = edits.some((e) => e.kind === "no-gps");
  const inCut = (t: number) => cuts.some(([a, b]) => t >= a && t <= b);
  const c = track.columns;
  const out: Sample[] = [];
  let excludedS = 0;
  let prevI = -1;
  let pendingBreak = false;
  let cum = 0;
  for (let i = 0; i < c.t.length; i++) {
    const t = c.t[i];
    if (t < lo || t > hi) continue;
    if (inCut(t)) {
      pendingBreak = prevI >= 0;
      continue;
    }
    if (dropped.has(Math.round(t))) continue;
    const brk = prevI >= 0 && pendingBreak;
    if (prevI >= 0) {
      if (brk) excludedS += t - c.t[prevI];
      else if (deviceDist) cum += Math.max(0, c.dist[i] - c.dist[prevI]);
      else if (!noGps && c.lat[prevI] !== null && c.lng[prevI] !== null && c.lat[i] !== null && c.lng[i] !== null) {
        cum += haversineM(c.lat[prevI]!, c.lng[prevI]!, c.lat[i]!, c.lng[i]!);
      } else if (!noGps) cum += Math.max(0, c.dist[i] - c.dist[prevI]);
    }
    out.push({
      t, lat: noGps ? null : c.lat[i], lng: noGps ? null : c.lng[i], ele: c.ele[i], hr: c.hr[i],
      cadence: c.cadence[i], watts: c.watts[i], speed: c.speed[i], dist: cum, brk,
    });
    prevI = i;
    pendingBreak = false;
  }
  return { samples: out, excludedS };
}

// drop the first startM / last endM metres of a part (merge boundaries keep
// the privacy trim every recording gets at its own ends)
function trimPart(samples: Sample[], startM: number, endM: number): Sample[] {
  if (!samples.length || (startM <= 0 && endM <= 0)) return samples;
  const d0 = samples[0].dist;
  const d1 = samples[samples.length - 1].dist;
  return samples.filter((s) => s.dist - d0 >= startM && d1 - s.dist >= endM);
}

export interface CleaningOptions {
  // privacy trim applied at every merge boundary (the outer ends are trimmed
  // later like any track)
  boundaryTrim?: { startM: number; endM: number };
}

// merged parts are appended in start order after the base track
export function applyCleaning(
  track: CanonicalTrack,
  edits: EditLike[],
  merged: (CanonicalTrack | MergedPart)[] = [],
  opts: CleaningOptions = {}
): CleanedTrack {
  if (!hasCleaning(edits) && merged.length === 0) {
    return { track, breaks: track.columns.t.map(() => false), excludedS: 0, cleaned: false };
  }
  const parts: MergedPart[] = merged
    .map((m) => ("columns" in m ? { track: m, edits: [] } : m))
    .sort((a, b) => a.track.startEpochMs - b.track.startEpochMs);
  const bt = opts.boundaryTrim ?? { startM: 0, endM: 0 };

  const base = cleanPart(track, edits);
  let all = parts.length ? trimPart(base.samples, 0, bt.endM) : base.samples;
  let excludedS = base.excludedS;
  parts.forEach((p, k) => {
    const offset = (p.track.startEpochMs - track.startEpochMs) / 1000;
    const cleaned = cleanPart(p.track, p.edits);
    excludedS += cleaned.excludedS;
    const last = k === parts.length - 1;
    const samples = trimPart(cleaned.samples, bt.startM, last ? 0 : bt.endM);
    const distBase = all.length ? all[all.length - 1].dist : 0;
    const prevLastT = all.length ? all[all.length - 1].t : -Infinity;
    let first = true;
    const appended: Sample[] = [];
    for (const s of samples) {
      const t = s.t + offset;
      if (t <= prevLastT || (appended.length && t <= appended[appended.length - 1].t)) continue;
      appended.push({ ...s, t, dist: distBase + (s.dist - samples[0].dist), brk: first ? all.length > 0 : s.brk });
      if (first && all.length) excludedS += t - prevLastT;
      first = false;
    }
    all = [...all, ...appended];
  });

  const out: CanonicalTrack["columns"] = { t: [], lat: [], lng: [], ele: [], hr: [], cadence: [], watts: [], speed: [], dist: [] };
  const breaks: boolean[] = [];
  for (const s of all) {
    out.t.push(s.t);
    out.lat.push(s.lat);
    out.lng.push(s.lng);
    out.ele.push(s.ele);
    out.hr.push(s.hr);
    out.cadence.push(s.cadence);
    out.watts.push(s.watts);
    out.speed.push(s.speed);
    out.dist.push(s.dist);
    breaks.push(s.brk);
  }
  const timeRemoved = edits.some((e) => e.kind === "crop" || e.kind === "cut") || parts.length > 0;
  return {
    track: {
      ...track,
      // device totals no longer describe the cleaned track: stats get recomputed
      session: null,
      kilojoules: timeRemoved ? null : track.kilojoules,
      columns: out,
    },
    breaks,
    excludedS,
    cleaned: true,
  };
}
