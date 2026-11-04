import type { Exercise, MuscleRegion } from "./types";
import { EXERCISES, getExercise } from "./catalog";

export const MUSCLE_REGIONS: readonly MuscleRegion[] = [
  "chest",
  "front_delts",
  "side_delts",
  "rear_delts",
  "biceps",
  "triceps",
  "forearms",
  "traps",
  "lats",
  "upper_back",
  "lower_back",
  "abs",
  "obliques",
  "glutes",
  "quads",
  "hamstrings",
  "adductors",
  "abductors",
  "calves",
  "neck",
];

/** lowercase display labels, e.g. "front delts" */
export const MUSCLE_REGION_LABELS: Readonly<Record<MuscleRegion, string>> = {
  chest: "chest",
  front_delts: "front delts",
  side_delts: "side delts",
  rear_delts: "rear delts",
  biceps: "biceps",
  triceps: "triceps",
  forearms: "forearms",
  traps: "traps",
  lats: "lats",
  upper_back: "upper back",
  lower_back: "lower back",
  abs: "abs",
  obliques: "obliques",
  glutes: "glutes",
  quads: "quads",
  hamstrings: "hamstrings",
  adductors: "adductors",
  abductors: "abductors",
  calves: "calves",
  neck: "neck",
};

export const PRIMARY_WEIGHT = 1;
export const SECONDARY_WEIGHT = 0.5;

export interface MuscleLoadEntry {
  exercise: Pick<Exercise, "primary" | "secondary">;
  /** working (non-warm-up) sets performed */
  workingSets: number;
}

export interface MuscleLoad {
  /** sum of sets x weight per region (primary 1.0, secondary 0.5) */
  raw: Partial<Record<MuscleRegion, number>>;
  /** raw / max(raw), so the most-loaded region is 1 */
  normalized: Partial<Record<MuscleRegion, number>>;
}

export function computeMuscleLoad(entries: readonly MuscleLoadEntry[]): MuscleLoad {
  const raw: Partial<Record<MuscleRegion, number>> = {};
  const add = (region: MuscleRegion, amount: number) => {
    raw[region] = (raw[region] ?? 0) + amount;
  };
  for (const { exercise, workingSets } of entries) {
    // negative or NaN set counts would only come from bad input; never let them subtract
    if (!(workingSets > 0)) continue;
    // a region listed as both primary and secondary counts once, as primary
    for (const r of exercise.primary) add(r, workingSets * PRIMARY_WEIGHT);
    for (const r of exercise.secondary) if (!exercise.primary.includes(r)) add(r, workingSets * SECONDARY_WEIGHT);
  }
  let max = 0;
  for (const v of Object.values(raw)) if (v !== undefined && v > max) max = v;
  const normalized: Partial<Record<MuscleRegion, number>> = {};
  if (max > 0) for (const [r, v] of Object.entries(raw) as [MuscleRegion, number][]) normalized[r] = v / max;
  return { raw, normalized };
}

/** looks each exercise up by id (unknown ids are skipped) and computes the load */
export function muscleLoadForExercises(
  items: readonly { exerciseId: string; workingSets: number }[],
  catalog: readonly Exercise[] = EXERCISES,
): MuscleLoad {
  const entries: MuscleLoadEntry[] = [];
  for (const item of items) {
    const exercise = getExercise(item.exerciseId, catalog);
    if (exercise) entries.push({ exercise, workingSets: item.workingSets });
  }
  return computeMuscleLoad(entries);
}
