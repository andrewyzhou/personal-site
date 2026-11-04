import type { ActivityLink, LinkCandidate, LinkRole } from "./types";

/** sport types a watch strength recording can carry */
export const STRENGTH_SPORT_TYPES: readonly string[] = ["WeightTraining", "Workout"];

export interface LinkOptions {
  /** max |start delta| for primary/duplicate matches, minutes (default 20) */
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
}

/**
 * pick which watch recordings belong to a lifting workout. strong's share text
 * only has a start time, so matching is by start (+-windowMin); split
 * recordings chain on as continuations; a second recording within the window
 * (two devices) is a duplicate. pure: never mutates the candidates.
 */
export function linkWorkoutToActivities(
  workoutLocalStart: string,
  candidates: readonly LinkCandidate[],
  options?: LinkOptions,
): ActivityLink[] {
  const windowMin = options?.windowMin ?? 20;
  const gapMin = options?.continuationGapMin ?? 15;
  const w = localMinutes(workoutLocalStart);
  if (w === null) return [];

  const spans: Span[] = [];
  for (const c of candidates) {
    if (!STRENGTH_SPORT_TYPES.includes(c.sportType)) continue;
    const start = localMinutes(c.localStart);
    if (start === null) continue;
    const elapsed = Number.isFinite(c.elapsedS) && c.elapsedS > 0 ? c.elapsedS : 0;
    spans.push({ c, start, end: start + elapsed / 60, delta: start - w });
  }

  let primary: Span | null = null;
  for (const s of spans) {
    if (Math.abs(s.delta) > windowMin) continue;
    if (
      primary === null ||
      Math.abs(s.delta) < Math.abs(primary.delta) ||
      (Math.abs(s.delta) === Math.abs(primary.delta) && s.start < primary.start)
    ) {
      primary = s;
    }
  }
  if (primary === null) {
    // forgot to stop: the workout starts inside a recording that began earlier than
    // the window. the latest-starting container is the most specific one.
    let container: Span | null = null;
    for (const s of spans) {
      if (s.start <= w && w <= s.end && (container === null || s.start > container.start)) container = s;
    }
    if (container === null) return [];
    return [{ activityId: container.c.id, role: "overrun", deltaMin: Math.round(container.delta) }];
  }

  const roles = new Map<Span, LinkRole>([[primary, "primary"]]);
  const p = primary;
  for (const s of spans) {
    if (s === p) continue;
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
    for (const s of spans) {
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
