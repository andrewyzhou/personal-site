import type { ActivityLink, LinkCandidate, LinkRole } from "./types";

/** sport types a watch strength recording can carry */
export const STRENGTH_SPORT_TYPES: readonly string[] = ["WeightTraining", "Workout"];

export interface LinkOptions {
  /** how long before a recording starts the lift may begin and still belong to it, minutes (default 30) */
  leadMin?: number;
  /**
   * |start delta| inside which a recording counts as the lift's own (primary, its timing becomes the
   * workout's) rather than one the lift started partway through (overrun); also the reach for a
   * second device's duplicate. minutes (default 20)
   */
  windowMin?: number;
  /** max gap between the end of a linked recording and the start of a continuation, minutes (default 15) */
  continuationGapMin?: number;
}

// split recordings past this point are a different session, not a continuation
const MAX_CHAIN_MIN = 4 * 60;

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?/;

/** minutes since the epoch for a local wall-clock string, treated as utc so the runtime zone never matters */
function localMinutes(s: string): number | null {
  const m = LOCAL_RE.exec(s.trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = [m[1], m[2], m[3], m[4], m[5]].map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const ms = Date.UTC(y, mo - 1, d, h, mi, m[6] ? Number(m[6]) : 0);
  return ms / 60000;
}

interface Span {
  c: LinkCandidate;
  start: number;
  end: number;
  delta: number;
  strength: boolean;
}

/**
 * pick which watch recordings a lifting workout belongs to. share text only
 * has a start time. the lift belongs to a recording of any sport when it
 * starts within [recording start - leadMin, recording end] (a "bike + lift"
 * session recorded as one ride counts). when several match, a strength
 * recording wins, then the closest start (so among recordings already running,
 * the latest-starting one). split strength recordings chain on as
 * continuations, and a second strength recording within the window (two
 * devices) is a duplicate. no match: nothing (a lift-only session). pure:
 * never mutates the candidates.
 */
export function linkWorkoutToActivities(
  workoutLocalStart: string,
  candidates: readonly LinkCandidate[],
  options?: LinkOptions,
): ActivityLink[] {
  const leadMin = options?.leadMin ?? 30;
  const windowMin = options?.windowMin ?? 20;
  const gapMin = options?.continuationGapMin ?? 15;
  const w = localMinutes(workoutLocalStart);
  if (w === null) return [];

  const spans: Span[] = [];
  for (const c of candidates) {
    const start = localMinutes(c.localStart);
    if (start === null) continue;
    const elapsed = Number.isFinite(c.elapsedS) && c.elapsedS > 0 ? c.elapsedS : 0;
    spans.push({ c, start, end: start + elapsed / 60, delta: start - w, strength: STRENGTH_SPORT_TYPES.includes(c.sportType) });
  }

  let best: Span | null = null;
  for (const s of spans) {
    // end >= start, so a zero-length recording still matches from leadMin before it up to its start
    if (w < s.start - leadMin || w > s.end) continue;
    if (best === null || better(s, best)) best = s;
  }
  if (best === null) return [];

  // the lift started well into this recording: it anchors the workout's day and offset only
  if (best.delta < -windowMin) {
    return [{ activityId: best.c.id, role: "overrun", deltaMin: Math.round(best.delta) }];
  }

  const roles = new Map<Span, LinkRole>([[best, "primary"]]);
  const p = best;
  // only strength recordings attach as extra pieces of the same lift; a run
  // after the gym is its own activity
  const extras = spans.filter((s) => s !== p && s.strength);
  for (const s of extras) {
    // a short recording that ended just before the workout start still counts as in the window
    const distance = s.end < w ? w - s.end : s.start > w ? s.start - w : 0;
    if (distance > windowMin) continue;
    const overlaps = s.start < p.end && p.start < s.end;
    roles.set(s, overlaps ? "duplicate" : "continuation");
  }

  // chain split recordings until nothing new attaches
  let added = true;
  while (added) {
    added = false;
    for (const s of extras) {
      if (roles.has(s) || s.start - w > MAX_CHAIN_MIN) continue;
      for (const linked of roles.keys()) {
        if (s.start > linked.start && s.start - linked.end <= gapMin) {
          roles.set(s, "continuation");
          added = true;
          break;
        }
      }
    }
  }

  return [...roles.entries()]
    .sort(([a], [b]) => a.start - b.start || a.c.id - b.c.id)
    .map(([s, role]) => ({ activityId: s.c.id, role, deltaMin: Math.round(s.delta) }));
}

/** strength first, then the closest start, then the earlier start (already running), then the lower id */
function better(a: Span, b: Span): boolean {
  if (a.strength !== b.strength) return a.strength;
  const da = Math.abs(a.delta);
  const db = Math.abs(b.delta);
  if (da !== db) return da < db;
  if (a.start !== b.start) return a.start < b.start;
  return a.c.id < b.c.id;
}
