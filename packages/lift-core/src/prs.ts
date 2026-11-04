import type { HistorySet } from "./history";
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

/**
 * records set by `workoutId` against everything that started before it.
 * same rules as history.ts: completed working sets only, positive weight/reps.
 * at most one hit per (exercise, kind), the best one.
 */
export function detectWorkoutPrs(sets: readonly HistorySet[], workoutId: string, options?: PrOptions): PrHit[] {
  void sets;
  void workoutId;
  void options;
  throw new Error("not implemented");
}
