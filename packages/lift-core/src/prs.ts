import { exerciseSessions, personalRecords, type HistorySet } from "./history";
import { e1rm, isWorkingSet, toKg } from "./math";
import type { WeightUnit } from "./types";

export type PrKind = "e1rm" | "weight" | "reps_at_weight" | "volume";

export interface PrHit {
  exerciseId: string;
  kind: PrKind;
  /** the new value (kg for e1rm/weight/volume, reps for reps_at_weight) */
  value: number;
  /** previous best, null when this is the first time the exercise was logged */
  previous: number | null;
  /** the set that set the record (null for session volume) */
  set: { weight: number; unit: WeightUnit; reps: number } | null;
  /** for reps_at_weight: the weight in kg (rounded to 0.01) */
  atWeightKg?: number;
}

export interface PrOptions {
  /** don't report prs for an exercise's very first session (default true) */
  skipFirstSession?: boolean;
}

// same tolerance as history.ts: equal-in-kg loads are ties, and ties aren't prs
const EPS = 1e-9;

interface Loaded {
  weight: number;
  unit: WeightUnit;
  reps: number;
  kg: number;
}

/** a completed working set with a real load and reps; unit-less reads as lb like history.ts */
function loaded(set: HistorySet): Loaded | null {
  if (!set.completed || !isWorkingSet(set)) return null;
  if (set.weight === null || !Number.isFinite(set.weight) || set.weight <= 0) return null;
  if (set.reps === null || !Number.isFinite(set.reps) || set.reps <= 0) return null;
  const unit = set.unit ?? "lb";
  return { weight: set.weight, unit, reps: set.reps, kg: toKg(set.weight, unit) };
}

const roundKg = (kg: number): number => Math.round(kg * 100) / 100;
const asSet = (l: Loaded): PrHit["set"] => ({ weight: l.weight, unit: l.unit, reps: l.reps });

/**
 * records set by `workoutId` against everything that started before it.
 * same rules as history.ts: completed working sets only, positive weight/reps.
 * at most one hit per (exercise, kind), the best one.
 *
 * "before" = an earlier startedAt, or the same startedAt and a smaller
 * workoutId (so two workouts stamped the same minute still order stably).
 * reps_at_weight only counts weights done before: a brand-new weight is a
 * weight pr (if heaviest), not a rep pr. the best rep pr is the heaviest one.
 */
export function detectWorkoutPrs(sets: readonly HistorySet[], workoutId: string, options?: PrOptions): PrHit[] {
  const skipFirst = options?.skipFirstSession ?? true;
  const current = sets.filter((s) => s.workoutId === workoutId);
  const first = current[0];
  if (!first) return [];
  const startedAt = first.startedAt;
  const prior = sets.filter(
    (s) => s.workoutId !== workoutId && (s.startedAt < startedAt || (s.startedAt === startedAt && s.workoutId < workoutId)),
  );

  // exercises in the order they first appear in the workout
  const exerciseIds = [...new Set(current.map((s) => s.exerciseId))];
  const hits: PrHit[] = [];

  for (const exerciseId of exerciseIds) {
    const priorSessions = exerciseSessions(prior, exerciseId);
    if (skipFirst && priorSessions.length === 0) continue;
    const records = personalRecords(prior, exerciseId);
    const mine = current.filter((s) => s.exerciseId === exerciseId);

    let bestE1rm: { value: number; set: Loaded } | null = null;
    let heaviest: Loaded | null = null;
    const repsAt = new Map<number, Loaded>();
    for (const set of mine) {
      const l = loaded(set);
      if (!l) continue;
      const est = e1rm(l.kg, l.reps);
      if (est !== null && (bestE1rm === null || est > bestE1rm.value + EPS)) bestE1rm = { value: est, set: l };
      if (heaviest === null || l.kg > heaviest.kg + EPS || (Math.abs(l.kg - heaviest.kg) <= EPS && l.reps > heaviest.reps)) {
        heaviest = l;
      }
      const w = roundKg(l.kg);
      const at = repsAt.get(w);
      if (!at || l.reps > at.reps) repsAt.set(w, l);
    }

    const prevE1rm = records.bestE1rmKg?.value ?? null;
    if (bestE1rm && (prevE1rm === null || bestE1rm.value > prevE1rm + EPS)) {
      hits.push({ exerciseId, kind: "e1rm", value: bestE1rm.value, previous: prevE1rm, set: asSet(bestE1rm.set) });
    }

    const prevTop = records.heaviest ? toKg(records.heaviest.weight, records.heaviest.unit) : null;
    if (heaviest && (prevTop === null || heaviest.kg > prevTop + EPS)) {
      hits.push({ exerciseId, kind: "weight", value: heaviest.kg, previous: prevTop, set: asSet(heaviest) });
    }

    const priorReps = new Map(records.repsAtWeight.map((r) => [r.weightKg, r.reps]));
    let repHit: { weightKg: number; set: Loaded; previous: number } | null = null;
    for (const [weightKg, l] of repsAt) {
      const previous = priorReps.get(weightKg);
      if (previous === undefined || l.reps <= previous) continue;
      if (repHit === null || weightKg > repHit.weightKg) repHit = { weightKg, set: l, previous };
    }
    if (repHit) {
      hits.push({
        exerciseId,
        kind: "reps_at_weight",
        value: repHit.set.reps,
        previous: repHit.previous,
        set: asSet(repHit.set),
        atWeightKg: repHit.weightKg,
      });
    }

    const volume = exerciseSessions(mine, exerciseId)[0]?.volumeKg ?? 0;
    const prevVolume = priorSessions.reduce<number | null>(
      (best, s) => (s.volumeKg > 0 && (best === null || s.volumeKg > best) ? s.volumeKg : best),
      null,
    );
    if (volume > 0 && (prevVolume === null || volume > prevVolume + EPS)) {
      hits.push({ exerciseId, kind: "volume", value: volume, previous: prevVolume, set: null });
    }
  }
  return hits;
}
