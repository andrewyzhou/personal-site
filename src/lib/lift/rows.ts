import { customExerciseId, normalizeName, type Exercise, type ParsedSet } from "lift-core";
import type { NewExerciseAliasRow, NewExerciseMuscleRow, NewExerciseRow } from "@/lib/db/lift-schema";

// pure row builders shared by the ingest planner and the seed script

// the phone derives the same ids, so both sides use lift-core's pure hash
export { customExerciseId, nameKey, sha256Hex } from "lift-core";

export interface ExerciseRows {
  exercise: NewExerciseRow;
  aliases: NewExerciseAliasRow[];
  muscles: NewExerciseMuscleRow[];
}

export function catalogExerciseRows(ex: Exercise): ExerciseRows {
  const aliases = new Map<string, NewExerciseAliasRow>();
  for (const alias of [ex.name, ...ex.aliases]) {
    const normalized = normalizeName(alias);
    // first spelling wins so the canonical name is the stored alias text
    if (normalized && !aliases.has(normalized)) aliases.set(normalized, { exerciseId: ex.id, alias, normalized });
  }
  const muscles = new Map<string, NewExerciseMuscleRow>();
  for (const region of ex.primary) muscles.set(region, { exerciseId: ex.id, region, role: "primary" });
  // a region listed both ways counts as primary (pk is exercise+region)
  for (const region of ex.secondary) {
    if (!muscles.has(region)) muscles.set(region, { exerciseId: ex.id, region, role: "secondary" });
  }
  return {
    exercise: {
      id: ex.id,
      name: ex.name,
      equipment: ex.equipment,
      category: ex.category,
      tracking: ex.tracking,
      source: "catalog",
      isCustom: false,
      freeDbId: ex.freeDbId ?? null,
    },
    aliases: [...aliases.values()],
    muscles: [...muscles.values()],
  };
}

// strong prints equipment as a trailing parenthetical: "Curl (Cable)"
const EQUIPMENT_HINTS: Record<string, string> = {
  barbell: "barbell",
  dumbbell: "dumbbell",
  machine: "machine",
  cable: "cable",
  "smith machine": "smith",
  "ez bar": "ez_bar",
  kettlebell: "kettlebell",
  band: "band",
  bodyweight: "bodyweight",
  "weighted bodyweight": "weighted_bodyweight",
  "assisted bodyweight": "assisted_bodyweight",
  plate: "plate",
  "trap bar": "trap_bar",
  "medicine ball": "medicine_ball",
  cardio: "cardio",
};

export function guessEquipment(name: string): string {
  const m = /\(([^)]+)\)\s*$/.exec(name);
  return (m && EQUIPMENT_HINTS[m[1].trim().toLowerCase()]) || "other";
}

/** infer what a custom exercise tracks from the sets strong printed for it */
export function guessTracking(sets: readonly ParsedSet[]): string {
  if (sets.some((s) => s.distance != null)) return sets.some((s) => s.weight != null) ? "weight_distance" : "distance_duration";
  if (sets.some((s) => s.weight != null && !s.bodyweight)) return "weight_reps";
  if (sets.some((s) => s.weight != null && s.weight < 0)) return "assisted_bodyweight";
  if (sets.some((s) => s.weight != null)) return "weighted_bodyweight";
  if (sets.some((s) => s.reps != null)) return "reps";
  if (sets.some((s) => s.durationS != null)) return "duration";
  return "weight_reps";
}

export function customExerciseRows(name: string, sets: readonly ParsedSet[]): ExerciseRows {
  const id = customExerciseId(name);
  const normalized = normalizeName(name);
  return {
    exercise: {
      id,
      name: name.trim(),
      equipment: guessEquipment(name),
      category: "strength",
      tracking: guessTracking(sets),
      source: "strong",
      isCustom: true,
      freeDbId: null,
    },
    // the printed name as an alias so the next share resolves straight to this row
    aliases: normalized ? [{ exerciseId: id, alias: name.trim(), normalized }] : [],
    muscles: [],
  };
}
