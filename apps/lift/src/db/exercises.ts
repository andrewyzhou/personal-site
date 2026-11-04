import { count, eq, ne } from "drizzle-orm";
import { randomUUID } from "expo-crypto";
import { EXERCISES, type Equipment, type Exercise, type MuscleRegion, type TrackingType } from "lift-core";
import { db } from "./client";
import { notify } from "./events";
import { writeOutbox } from "./outbox";
import { customExercises, sets, workoutExercises, workouts } from "./schema";
import { CUSTOM_ID_PREFIX, customToExercise } from "../lib/custom";
import { toUsageMap } from "../lib/usage";

/** sets logged per exercise id, for the search usage boost. discarded workouts don't count. */
export function getUsageCounts(): Record<string, number> {
  const rows = db
    .select({ exerciseId: workoutExercises.exerciseId, count: count(sets.id) })
    .from(sets)
    .innerJoin(workoutExercises, eq(sets.workoutExerciseId, workoutExercises.id))
    .innerJoin(workouts, eq(workoutExercises.workoutId, workouts.id))
    .where(ne(workouts.status, "discarded"))
    .groupBy(workoutExercises.exerciseId)
    .all();
  return toUsageMap(rows);
}

export function listCustomExercises(): Exercise[] {
  return db.select().from(customExercises).where(eq(customExercises.archived, 0)).all().map(customToExercise);
}

/** built-in catalog plus the user's custom exercises: what search and lookups run over */
export function getCatalog(): readonly Exercise[] {
  const custom = listCustomExercises();
  return custom.length ? [...EXERCISES, ...custom] : EXERCISES;
}

export interface NewCustomExercise {
  name: string;
  equipment?: Equipment;
  tracking?: TrackingType;
  primary?: MuscleRegion[];
  secondary?: MuscleRegion[];
}

export function createCustomExercise(input: NewCustomExercise, now = Date.now()): Exercise {
  const row = db.transaction((tx) => {
    const inserted = tx
      .insert(customExercises)
      .values({
        id: CUSTOM_ID_PREFIX + randomUUID(),
        name: input.name.trim(),
        equipment: input.equipment ?? "other",
        tracking: input.tracking ?? "weight_reps",
        primary: JSON.stringify(input.primary ?? []),
        secondary: JSON.stringify(input.secondary ?? []),
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    writeOutbox(tx, "custom_exercise", inserted.id, "insert", inserted);
    return inserted;
  });
  notify();
  return customToExercise(row);
}
