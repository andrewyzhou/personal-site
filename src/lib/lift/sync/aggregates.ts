import { eq, inArray, or, sql, type SQL } from "drizzle-orm";
import { computeMuscleLoad, getExercise, toKg, type MuscleLoadEntry, type MuscleRegion } from "lift-core";
import type { getDb } from "@/lib/db";
import { exerciseMuscles, liftSets, liftWorkoutExercises, liftWorkouts } from "@/lib/db/lift-schema";

// workingSets / volumeKg / muscleLoad on lift_workouts are derived from the
// sets, so after a push they're recomputed from what's actually stored.
// idempotent: running it twice writes the same numbers.

type Db = ReturnType<typeof getDb>;

export interface AggregateSetRow {
  workoutId: string;
  exerciseId: string;
  /** null for an exercise with no sets (left join) */
  kind: string | null;
  weight: number | null;
  unit: string | null;
  reps: number | null;
  completed: boolean | null;
}

export interface MuscleRow {
  exerciseId: string;
  region: string;
  role: string;
}

export interface WorkoutAggregates {
  workingSets: number;
  volumeKg: number;
  muscleLoad: Record<string, number>;
}

function round(n: number, places: number): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

/** aggregates per workout id; ids with no rows get zeros */
export function computeAggregates(
  workoutIds: readonly string[],
  rows: readonly AggregateSetRow[],
  customMuscles: readonly MuscleRow[]
): Map<string, WorkoutAggregates> {
  const custom = new Map<string, { primary: MuscleRegion[]; secondary: MuscleRegion[] }>();
  for (const m of customMuscles) {
    const e = custom.get(m.exerciseId) ?? { primary: [], secondary: [] };
    (m.role === "primary" ? e.primary : e.secondary).push(m.region as MuscleRegion);
    custom.set(m.exerciseId, e);
  }

  const perWorkout = new Map<string, { sets: number; volume: number; byExercise: Map<string, number> }>();
  for (const id of workoutIds) perWorkout.set(id, { sets: 0, volume: 0, byExercise: new Map() });
  for (const r of rows) {
    let w = perWorkout.get(r.workoutId);
    if (!w) {
      w = { sets: 0, volume: 0, byExercise: new Map() };
      perWorkout.set(r.workoutId, w);
    }
    // skipped (unticked) sets and warm-ups don't count
    if (r.kind == null || r.kind === "warmup" || r.completed === false) continue;
    w.sets++;
    w.byExercise.set(r.exerciseId, (w.byExercise.get(r.exerciseId) ?? 0) + 1);
    if (r.weight != null && r.weight > 0 && r.reps != null && r.reps > 0 && (r.unit === "lb" || r.unit === "kg")) {
      w.volume += toKg(r.weight, r.unit) * r.reps;
    }
  }

  const out = new Map<string, WorkoutAggregates>();
  for (const [id, w] of perWorkout) {
    const entries: MuscleLoadEntry[] = [];
    for (const [exId, workingSets] of w.byExercise) {
      const exercise = getExercise(exId) ?? custom.get(exId);
      if (exercise) entries.push({ exercise, workingSets });
    }
    const load: Record<string, number> = {};
    if (entries.length) {
      for (const [region, v] of Object.entries(computeMuscleLoad(entries).normalized)) {
        if (typeof v === "number") load[region] = round(v, 3);
      }
    }
    out.set(id, { workingSets: w.sets, volumeKg: round(w.volume, 2), muscleLoad: load });
  }
  return out;
}

/** recompute and store aggregates for these workouts plus every workout using `exerciseIds` */
export async function recomputeWorkoutAggregates(
  db: Db,
  workoutIds: readonly string[],
  exerciseIds: readonly string[] = []
): Promise<number> {
  if (!workoutIds.length && !exerciseIds.length) return 0;
  const we = liftWorkoutExercises;
  const scope: SQL[] = [];
  if (workoutIds.length) scope.push(inArray(we.workoutId, [...workoutIds]));
  if (exerciseIds.length) {
    scope.push(
      sql`${we.workoutId} in (select x."workout_id" from "lift_workout_exercises" x where x."exercise_id" in (${sql.join(
        exerciseIds.map((id) => sql`${id}`),
        sql`, `
      )}))`
    );
  }
  const rows = await db
    .select({
      workoutId: we.workoutId,
      exerciseId: we.exerciseId,
      kind: liftSets.kind,
      weight: liftSets.weight,
      unit: liftSets.unit,
      reps: liftSets.reps,
      completed: liftSets.completed,
    })
    .from(we)
    .leftJoin(liftSets, eq(liftSets.workoutExerciseId, we.id))
    .where(scope.length === 1 ? scope[0] : or(...scope));

  const customIds = [...new Set(rows.map((r) => r.exerciseId))].filter((id) => !getExercise(id));
  const muscles = customIds.length
    ? await db
        .select({ exerciseId: exerciseMuscles.exerciseId, region: exerciseMuscles.region, role: exerciseMuscles.role })
        .from(exerciseMuscles)
        .where(inArray(exerciseMuscles.exerciseId, customIds))
    : [];

  const aggregates = computeAggregates(workoutIds, rows, muscles);
  if (!aggregates.size) return 0;
  // updated_at is the phone's lww clock, so derived columns don't touch it
  const updates = [...aggregates].map(([id, a]) =>
    db
      .update(liftWorkouts)
      .set({ workingSets: a.workingSets, volumeKg: a.volumeKg, muscleLoad: a.muscleLoad })
      .where(eq(liftWorkouts.id, id))
  );
  await db.batch(updates as [(typeof updates)[number], ...typeof updates]);
  return updates.length;
}
