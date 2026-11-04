// workout summary numbers. pure so it runs under vitest; the screen feeds it
// sqlite rows. volume follows the history list: completed working sets with a
// positive load and reps.

import { computeMuscleLoad, e1rm, isWorkingSet, toKg, type Exercise, type MuscleLoad, type SetKind, type WeightUnit } from "lift-core";

export interface SummarySet {
  kind: SetKind;
  weight: number | null;
  unit: WeightUnit;
  reps: number | null;
  completed: boolean | number;
}

export interface SummaryInput {
  startedAt: number;
  endedAt: number | null;
  exercises: { exerciseId: string; sets: readonly SummarySet[] }[];
}

export interface BestSet {
  weight: number;
  unit: WeightUnit;
  reps: number;
  /** null past the rep range e1rm is useful for */
  e1rmKg: number | null;
}

export interface ExerciseLine {
  exerciseId: string;
  workingSets: number;
  volumeKg: number;
  best: BestSet | null;
}

export interface WorkoutSummaryData {
  durationMs: number | null;
  workingSets: number;
  volumeKg: number;
  /** one line per exercise id, in first-seen order (repeat entries merge) */
  exercises: ExerciseLine[];
}

function loaded(s: SummarySet): { kg: number; reps: number; weight: number } | null {
  if (s.weight === null || !(s.weight > 0) || s.reps === null || !(s.reps > 0)) return null;
  return { kg: toKg(s.weight, s.unit), reps: s.reps, weight: s.weight };
}

/** higher e1rm wins; without one, heavier then more reps */
export function betterSet(a: BestSet, b: BestSet | null): boolean {
  if (b === null) return true;
  if (a.e1rmKg !== null && b.e1rmKg !== null) return a.e1rmKg > b.e1rmKg + 1e-9;
  if (a.e1rmKg !== null) return true;
  if (b.e1rmKg !== null) return false;
  const ak = toKg(a.weight, a.unit);
  const bk = toKg(b.weight, b.unit);
  return ak > bk + 1e-9 || (Math.abs(ak - bk) <= 1e-9 && a.reps > b.reps);
}

export function summarize(input: SummaryInput): WorkoutSummaryData {
  const lines = new Map<string, ExerciseLine>();
  let workingSets = 0;
  let volumeKg = 0;
  for (const ex of input.exercises) {
    let line = lines.get(ex.exerciseId);
    if (!line) {
      line = { exerciseId: ex.exerciseId, workingSets: 0, volumeKg: 0, best: null };
      lines.set(ex.exerciseId, line);
    }
    for (const s of ex.sets) {
      if (!s.completed || !isWorkingSet(s)) continue;
      line.workingSets++;
      workingSets++;
      const l = loaded(s);
      if (!l) continue;
      line.volumeKg += l.kg * l.reps;
      volumeKg += l.kg * l.reps;
      const cand: BestSet = { weight: l.weight, unit: s.unit, reps: l.reps, e1rmKg: e1rm(l.kg, l.reps) };
      if (betterSet(cand, line.best)) line.best = cand;
    }
  }
  return {
    durationMs: input.endedAt !== null ? Math.max(0, input.endedAt - input.startedAt) : null,
    workingSets,
    volumeKg,
    exercises: [...lines.values()],
  };
}

/** muscle load over the completed working sets; unknown exercises are skipped */
export function summaryMuscleLoad(
  lines: readonly Pick<ExerciseLine, "exerciseId" | "workingSets">[],
  lookup: (id: string) => Pick<Exercise, "primary" | "secondary"> | undefined
): MuscleLoad {
  const entries = [];
  for (const l of lines) {
    const exercise = lookup(l.exerciseId);
    if (exercise && l.workingSets > 0) entries.push({ exercise, workingSets: l.workingSets });
  }
  return computeMuscleLoad(entries);
}
