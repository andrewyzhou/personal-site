import type { Exercise, MuscleRegion } from "./types";

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
  void entries;
  throw new Error("not implemented");
}
