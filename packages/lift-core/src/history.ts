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

/** per-session series for one exercise, oldest first (completed working sets only) */
export function exerciseSessions(sets: readonly HistorySet[], exerciseId: string): SessionPoint[] {
  void sets;
  void exerciseId;
  throw new Error("not implemented");
}

export interface PersonalRecords {
  bestE1rmKg: { value: number; workoutId: string; startedAt: number } | null;
  heaviest: { weight: number; unit: WeightUnit; reps: number; workoutId: string; startedAt: number } | null;
  /** best reps at each exact weight (kg, rounded to 0.01), for the "rep pr" table */
  repsAtWeight: { weightKg: number; reps: number; startedAt: number }[];
}

export function personalRecords(sets: readonly HistorySet[], exerciseId: string): PersonalRecords {
  void sets;
  void exerciseId;
  throw new Error("not implemented");
}
