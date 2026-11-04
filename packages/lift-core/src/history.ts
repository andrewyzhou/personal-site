import { e1rm, isWorkingSet, toKg } from "./math";
import type { SetKind, WeightUnit } from "./types";

/** one logged set, flattened with its workout, as either side can produce it */
export interface HistorySet {
  workoutId: string;
  /** workout start, epoch ms */
  startedAt: number;
  exerciseId: string;
  kind: SetKind;
  weight: number | null;
  unit: WeightUnit | null;
  reps: number | null;
  completed: boolean;
}

export interface SessionPoint {
  workoutId: string;
  startedAt: number;
  /** best e1rm that session, kg */
  e1rmKg: number | null;
  /** working-set volume that session, kg */
  volumeKg: number;
  /** heaviest working set that session */
  topSet: { weight: number; unit: WeightUnit; reps: number } | null;
  workingSets: number;
}

const EPS = 1e-9;

interface Loaded {
  set: HistorySet;
  weight: number;
  unit: WeightUnit;
  reps: number;
  kg: number;
}

/** completed working sets of one exercise, oldest first (stable within a workout) */
function relevant(sets: readonly HistorySet[], exerciseId: string): HistorySet[] {
  return sets
    .map((set, i) => ({ set, i }))
    .filter(({ set }) => set.exerciseId === exerciseId && set.completed && isWorkingSet(set))
    .sort((a, b) => a.set.startedAt - b.set.startedAt || a.i - b.i)
    .map(({ set }) => set);
}

/** a set with a real load and reps; unit-less loads read as lb like summarizeWorkout */
function loaded(set: HistorySet): Loaded | null {
  if (set.weight === null || !Number.isFinite(set.weight) || set.weight <= 0) return null;
  if (set.reps === null || !Number.isFinite(set.reps) || set.reps <= 0) return null;
  const unit = set.unit ?? "lb";
  return { set, weight: set.weight, unit, reps: set.reps, kg: toKg(set.weight, unit) };
}

/** heavier in kg wins; equal load -> more reps */
function heavier(a: Loaded, b: Loaded | null): boolean {
  if (b === null) return true;
  return a.kg > b.kg + EPS || (Math.abs(a.kg - b.kg) <= EPS && a.reps > b.reps);
}

/** per-session series for one exercise, oldest first (completed working sets only) */
export function exerciseSessions(sets: readonly HistorySet[], exerciseId: string): SessionPoint[] {
  const sessions = new Map<string, { point: SessionPoint; top: Loaded | null }>();
  for (const set of relevant(sets, exerciseId)) {
    let s = sessions.get(set.workoutId);
    if (!s) {
      s = {
        point: { workoutId: set.workoutId, startedAt: set.startedAt, e1rmKg: null, volumeKg: 0, topSet: null, workingSets: 0 },
        top: null,
      };
      sessions.set(set.workoutId, s);
    }
    s.point.workingSets++;
    const l = loaded(set);
    if (!l) continue;
    // same rule as setVolumeKg: without a unit we can't convert
    if (set.unit !== null) s.point.volumeKg += l.kg * l.reps;
    const est = e1rm(l.kg, l.reps);
    if (est !== null && (s.point.e1rmKg === null || est > s.point.e1rmKg)) s.point.e1rmKg = est;
    if (heavier(l, s.top)) s.top = l;
  }
  return [...sessions.values()]
    .map(({ point, top }) => ({ ...point, topSet: top ? { weight: top.weight, unit: top.unit, reps: top.reps } : null }))
    .sort((a, b) => a.startedAt - b.startedAt);
}

export interface PersonalRecords {
  bestE1rmKg: { value: number; workoutId: string; startedAt: number } | null;
  heaviest: { weight: number; unit: WeightUnit; reps: number; workoutId: string; startedAt: number } | null;
  /** best reps at each exact weight (kg, rounded to 0.01), for the "rep pr" table */
  repsAtWeight: { weightKg: number; reps: number; startedAt: number }[];
}

/** all-time records from completed working sets; ties go to the earliest set. repsAtWeight is lightest first. */
export function personalRecords(sets: readonly HistorySet[], exerciseId: string): PersonalRecords {
  let best: PersonalRecords["bestE1rmKg"] = null;
  let top: Loaded | null = null;
  const byWeight = new Map<number, { weightKg: number; reps: number; startedAt: number }>();

  for (const set of relevant(sets, exerciseId)) {
    const l = loaded(set);
    if (!l) continue;
    const est = e1rm(l.kg, l.reps);
    if (est !== null && (best === null || est > best.value + EPS)) {
      best = { value: est, workoutId: set.workoutId, startedAt: set.startedAt };
    }
    if (heavier(l, top)) top = l;
    const weightKg = Math.round(l.kg * 100) / 100;
    const prev = byWeight.get(weightKg);
    if (!prev || l.reps > prev.reps) byWeight.set(weightKg, { weightKg, reps: l.reps, startedAt: set.startedAt });
  }

  return {
    bestE1rmKg: best,
    heaviest: top
      ? { weight: top.weight, unit: top.unit, reps: top.reps, workoutId: top.set.workoutId, startedAt: top.set.startedAt }
      : null,
    repsAtWeight: [...byWeight.values()].sort((a, b) => a.weightKg - b.weightKg),
  };
}
