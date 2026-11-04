import type { ParsedSet, ParsedWorkout, WeightUnit } from "./types";

export const LB_PER_KG = 2.2046226218;

// past this, rep-based estimates drift too far from a real single to be useful
const MAX_E1RM_REPS = 15;

export function toKg(weight: number, unit: WeightUnit): number {
  return unit === "kg" ? weight : weight / LB_PER_KG;
}

export function fromKg(kg: number, unit: WeightUnit): number {
  return unit === "kg" ? kg : kg * LB_PER_KG;
}

/** estimated one-rep max (epley by default); null when not computable */
export function e1rm(weight: number, reps: number, formula: "epley" | "brzycki" = "epley"): number | null {
  if (!Number.isFinite(weight) || !Number.isFinite(reps)) return null;
  if (weight <= 0 || reps <= 0 || reps > MAX_E1RM_REPS) return null;
  if (reps === 1) return weight;
  if (formula === "brzycki") return (weight * 36) / (37 - reps);
  return weight * (1 + reps / 30);
}

/** true for sets that count toward volume / set counts (everything except warm-ups) */
export function isWorkingSet(set: Pick<ParsedSet, "kind">): boolean {
  return set.kind !== "warmup";
}

/** weight x reps in kg for a working weighted set, else 0 */
export function setVolumeKg(set: ParsedSet): number {
  if (!isWorkingSet(set)) return 0;
  // an assisted set's negative load isn't lifted weight, and without a unit we can't convert
  if (set.weight === null || set.weight <= 0 || set.unit === null) return 0;
  if (set.reps === null || set.reps <= 0) return 0;
  return toKg(set.weight, set.unit) * set.reps;
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
  let lbSets = 0;
  let kgSets = 0;
  let totalSets = 0;
  let totalVolume = 0;

  const exercises = workout.exercises.map((ex): ExerciseSummary => {
    let workingSets = 0;
    let volumeKg = 0;
    let bestE1rmKg: number | null = null;
    let top: { weight: number; unit: WeightUnit; reps: number; kg: number } | null = null;

    for (const set of ex.sets) {
      if (set.weight !== null && set.unit === "lb") lbSets++;
      if (set.weight !== null && set.unit === "kg") kgSets++;
      if (!isWorkingSet(set)) continue;
      workingSets++;
      volumeKg += setVolumeKg(set);

      if (set.weight === null || set.weight <= 0 || set.reps === null || set.reps <= 0) continue;
      const unit = set.unit ?? "lb";
      const kg = toKg(set.weight, unit);
      const est = e1rm(kg, set.reps);
      if (est !== null && (bestE1rmKg === null || est > bestE1rmKg)) bestE1rmKg = est;
      // compare in kg so a mixed-unit exercise still picks the truly heaviest set
      if (top === null || kg > top.kg + 1e-9 || (Math.abs(kg - top.kg) <= 1e-9 && set.reps > top.reps)) {
        top = { weight: set.weight, unit, reps: set.reps, kg };
      }
    }

    totalSets += workingSets;
    totalVolume += volumeKg;
    return {
      name: ex.name,
      workingSets,
      volumeKg,
      bestE1rmKg,
      topSet: top ? { weight: top.weight, unit: top.unit, reps: top.reps } : null,
    };
  });

  return {
    exerciseCount: workout.exercises.length,
    workingSets: totalSets,
    volumeKg: totalVolume,
    unit: kgSets > lbSets ? "kg" : "lb",
    exercises,
  };
}
