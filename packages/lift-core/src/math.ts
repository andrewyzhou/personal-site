import type { ParsedSet, ParsedWorkout, WeightUnit } from "./types";

export const LB_PER_KG = 2.2046226218;

export function toKg(weight: number, unit: WeightUnit): number {
  void weight;
  void unit;
  throw new Error("not implemented");
}

export function fromKg(kg: number, unit: WeightUnit): number {
  void kg;
  void unit;
  throw new Error("not implemented");
}

/** estimated one-rep max (epley by default); null when not computable */
export function e1rm(weight: number, reps: number, formula?: "epley" | "brzycki"): number | null {
  void weight;
  void reps;
  void formula;
  throw new Error("not implemented");
}

/** true for sets that count toward volume / set counts (everything except warm-ups) */
export function isWorkingSet(set: Pick<ParsedSet, "kind">): boolean {
  void set;
  throw new Error("not implemented");
}

/** weight x reps in kg for a working weighted set, else 0 */
export function setVolumeKg(set: ParsedSet): number {
  void set;
  throw new Error("not implemented");
}

export interface ExerciseSummary {
  name: string;
  workingSets: number;
  volumeKg: number;
  /** best e1rm across working sets, kg */
  bestE1rmKg: number | null;
  /** heaviest working set, as printed */
  topSet: { weight: number; unit: WeightUnit; reps: number } | null;
}

export interface WorkoutSummary {
  exerciseCount: number;
  workingSets: number;
  volumeKg: number;
  /** the unit most sets were logged in (lb when tied/none) */
  unit: WeightUnit;
  exercises: ExerciseSummary[];
}

export function summarizeWorkout(workout: ParsedWorkout): WorkoutSummary {
  void workout;
  throw new Error("not implemented");
}
