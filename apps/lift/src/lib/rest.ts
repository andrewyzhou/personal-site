// rest timer math. pure (no rn imports) so it runs under vitest; the runtime
// store that persists it and schedules the notification lives in
// components/workout/restTimer.ts.

export const DEFAULT_REST_S = 120;
export const REST_STEP_S = 15;
// ceiling for typos and runaway +15 taps; 30 min of rest is not a set break
export const MAX_REST_S = 30 * 60;

export interface RestTimer {
  /** epoch ms when the rest is over */
  endsAt: number;
  /** total length in seconds, for the progress bar (grows/shrinks with adjust) */
  durationS: number;
  /** workout exercise whose set started it, for the label */
  workoutExerciseId: string | null;
}

export function clampRestS(s: number): number {
  if (!Number.isFinite(s)) return DEFAULT_REST_S;
  return Math.min(MAX_REST_S, Math.max(0, Math.round(s)));
}

/** per-exercise override wins; null/undefined falls back to the app default */
export function resolveRestS(exerciseRestS: number | null | undefined, defaultRestS: number): number {
  return clampRestS(exerciseRestS ?? defaultRestS);
}

export function startTimer(durationS: number, now: number, workoutExerciseId: string | null = null): RestTimer {
  const d = clampRestS(durationS);
  return { endsAt: now + d * 1000, durationS: d, workoutExerciseId };
}

export function remainingMs(timer: RestTimer, now: number): number {
  return Math.max(0, timer.endsAt - now);
}

/** whole seconds left, rounded up so "0:01" shows until it is really over */
export function remainingS(timer: RestTimer, now: number): number {
  return Math.ceil(remainingMs(timer, now) / 1000);
}

export function isOver(timer: RestTimer, now: number): boolean {
  return timer.endsAt <= now;
}

/** fraction of the rest still left, 1 -> 0 */
export function fractionLeft(timer: RestTimer, now: number): number {
  if (timer.durationS <= 0) return 0;
  return Math.min(1, remainingMs(timer, now) / (timer.durationS * 1000));
}

/**
 * -15/+15. never ends in the past (a -15 near the end just finishes it) and
 * the bar's total moves with it so the fill stays truthful. null = now over.
 */
export function adjustTimer(timer: RestTimer, deltaS: number, now: number): RestTimer | null {
  const left = remainingMs(timer, now) + deltaS * 1000;
  if (left <= 0) return null;
  const cappedLeft = Math.min(left, MAX_REST_S * 1000);
  const elapsed = Math.max(0, timer.durationS * 1000 - remainingMs(timer, now));
  return {
    ...timer,
    endsAt: now + cappedLeft,
    durationS: Math.max(1, Math.round((elapsed + cappedLeft) / 1000)),
  };
}

/** "m:ss" for the bar */
export function formatRest(s: number): string {
  const t = Math.max(0, Math.round(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}

/** kv round trip; anything malformed reads as "no timer" rather than crashing on launch */
export function parseRestTimer(json: string | null | undefined): RestTimer | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json) as Partial<RestTimer> | null;
    if (!v || typeof v.endsAt !== "number" || !Number.isFinite(v.endsAt)) return null;
    if (typeof v.durationS !== "number" || !Number.isFinite(v.durationS)) return null;
    return {
      endsAt: v.endsAt,
      durationS: v.durationS,
      workoutExerciseId: typeof v.workoutExerciseId === "string" ? v.workoutExerciseId : null,
    };
  } catch {
    return null;
  }
}

/**
 * a timer found on launch/resume that ended a while ago already notified
 * the user; only one that just ended (js timers lag a little) gets the
 * in-app haptic.
 */
export const LATE_END_GRACE_MS = 2000;

export function endedJustNow(timer: RestTimer, now: number): boolean {
  return isOver(timer, now) && now - timer.endsAt <= LATE_END_GRACE_MS;
}

export interface RoundExercise {
  id: string;
  supersetGroup: number | null;
  sets: readonly { id: string; completed: number | boolean }[];
}

/**
 * whether completing `setId` should start the rest timer. outside a superset:
 * always. inside one: only once every exercise in the group has completed its
 * set of that round (round = set index), so a1 -> b1 runs without a break and
 * the rest starts after b1. order-independent: b1 then a1 also rests after a1.
 * `exercises` is the workout in display order.
 */
export function shouldStartRest(exercises: readonly RoundExercise[], setId: string): boolean {
  const owner = exercises.find((e) => e.sets.some((s) => s.id === setId));
  if (!owner) return false;
  if (owner.supersetGroup == null) return true;
  const round = owner.sets.findIndex((s) => s.id === setId);
  const group = exercises.filter((e) => e.supersetGroup === owner.supersetGroup);
  return group.every((e) => {
    const s = e.sets[round];
    return !s || Boolean(s.completed);
  });
}
