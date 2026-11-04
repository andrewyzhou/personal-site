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
      return { ok: true, params: { startS, endS } };
    }
    case "cut": {
      if (!isNum(p.fromS) || !isNum(p.toS) || p.fromS < 0 || p.toS <= p.fromS) return { ok: false, error: "cut needs 0 ≤ fromS < toS" };
      return { ok: true, params: { fromS: p.fromS, toS: p.toS } };
    }
    case "drop-points": {
      if (!Array.isArray(p.ts) || p.ts.length === 0 || p.ts.length > MAX_DROP_POINTS || !p.ts.every(isNum)) {
        return { ok: false, error: `drop-points needs ts: 1..${MAX_DROP_POINTS} numbers` };
      }
      return { ok: true, params: { ts: [...new Set(p.ts as number[])].sort((a, b) => a - b) } };
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

// the latest crop is the one in effect, so a crop that only sets one side
// (e.g. an accepted "crop the tail") must carry the other side of the crop
// already in effect, or accepting it would undo an earlier head crop
export function combineCrop(edits: EditLike[], proposed: Record<string, unknown>): Record<string, unknown> {
  const crops = edits.filter((e) => e.kind === "crop");
  const cur = crops[crops.length - 1]?.params ?? {};
  const pick = (k: "startS" | "endS") => (isNum(proposed[k]) ? proposed[k] : isNum(cur[k]) ? cur[k] : null);
  const startS = pick("startS");
  const endS = pick("endS");
  // a stale other side that no longer makes a valid window is dropped
  if (isNum(startS) && isNum(endS) && endS <= startS) return { startS: proposed.startS ?? null, endS: proposed.endS ?? null };
  return { startS, endS };
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

// merged tracks are appended in start order after the base track
export function applyCleaning(track: CanonicalTrack, edits: EditLike[], merged: CanonicalTrack[] = []): CleanedTrack {
  if (!hasCleaning(edits)) {
    return { track, breaks: track.columns.t.map(() => false), excludedS: 0, cleaned: false };
  }
  const deviceDist = track.source.fileType === "fit" || track.source.kind === "strava-streams";

  // 1. concatenate merged tracks (only samples after what's already there)
  type S = { t: number; lat: number | null; lng: number | null; ele: number | null; hr: number | null; cadence: number | null; watts: number | null; speed: number | null; dist: number; gapBefore: boolean };
  const all: S[] = [];
  const push = (tr: CanonicalTrack, offsetS: number, distBase: number) => {
    const c = tr.columns;
    let first = true;
    for (let i = 0; i < c.t.length; i++) {
      const t = c.t[i] + offsetS;
      if (all.length && t <= all[all.length - 1].t) continue;
      all.push({
        t, lat: c.lat[i], lng: c.lng[i], ele: c.ele[i], hr: c.hr[i], cadence: c.cadence[i], watts: c.watts[i], speed: c.speed[i],
        dist: distBase + (c.dist[i] - c.dist[0]),
        gapBefore: first && all.length > 0,
      });
      first = false;
    }
  };
  push(track, 0, 0);
  for (const m of [...merged].sort((a, b) => a.startEpochMs - b.startEpochMs)) {
    push(m, (m.startEpochMs - track.startEpochMs) / 1000, all.length ? all[all.length - 1].dist : 0);
  }

  // 2. which samples survive
  const crops = edits.filter((e) => e.kind === "crop");
  const crop = crops[crops.length - 1];
  const lo = crop && isNum(crop.params.startS) ? crop.params.startS : -Infinity;
  const hi = crop && isNum(crop.params.endS) ? crop.params.endS : Infinity;
  const cuts = edits.filter((e) => e.kind === "cut").map((e) => [Number(e.params.fromS), Number(e.params.toS)] as const);
  const dropped = new Set<number>();
  for (const e of edits) if (e.kind === "drop-points" && Array.isArray(e.params.ts)) for (const t of e.params.ts as number[]) dropped.add(t);
  const noGps = edits.some((e) => e.kind === "no-gps");
  const inCut = (t: number) => cuts.some(([a, b]) => t >= a && t <= b);

  // 3. rebuild columns; distance deltas skip discontinuities, and spikes are
  // re-measured (device distance channels don't include them, gps ones do)
  const out: CanonicalTrack["columns"] = { t: [], lat: [], lng: [], ele: [], hr: [], cadence: [], watts: [], speed: [], dist: [] };
  const breaks: boolean[] = [];
  let excludedS = 0;
  let prev: S | null = null;
  let pendingBreak = false;
  let cum = 0;
  for (const s of all) {
    if (s.t < lo || s.t > hi) continue;
    if (inCut(s.t)) {
      pendingBreak = prev !== null;
      continue;
    }
    if (dropped.has(s.t)) continue;
    const brk = prev !== null && (pendingBreak || s.gapBefore);
    if (prev) {
      if (brk) excludedS += s.t - prev.t;
      else if (deviceDist) cum += Math.max(0, s.dist - prev.dist);
      else if (prev.lat !== null && prev.lng !== null && s.lat !== null && s.lng !== null && !noGps) cum += haversineM(prev.lat, prev.lng, s.lat, s.lng);
      else if (!noGps) cum += Math.max(0, s.dist - prev.dist);
    }
    out.t.push(s.t);
    out.lat.push(noGps ? null : s.lat);
    out.lng.push(noGps ? null : s.lng);
    out.ele.push(s.ele);
    out.hr.push(s.hr);
    out.cadence.push(s.cadence);
    out.watts.push(s.watts);
    out.speed.push(s.speed);
    out.dist.push(cum);
    breaks.push(brk);
    prev = s;
    pendingBreak = false;
  }

  const timeRemoved = crop !== undefined || cuts.length > 0 || merged.length > 0;
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
