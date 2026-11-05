// the bot's read-only queries. each question costs one or two selects:
// workout questions read lift_workouts (with a few per-row subqueries), exercise
// questions read one exercise's sets, plus the owner's exercise list only when
// the name isn't a catalog name or alias.

import { and, asc, desc, eq, gte, isNull, lt, ne, or, sql, type SQL } from "drizzle-orm";
import {
  activities,
  exercises,
  getDb,
  liftSets,
  liftWorkoutActivities,
  liftWorkoutExercises,
  liftWorkouts,
} from "@/lib/db";
import type { KnownExercise } from "./intent";
import type { QuerySet, QueryWorkout } from "./answer";
import type { DateWindow } from "./window";

export interface QueryStore {
  /** live workouts, newest first, optionally inside a window */
  workouts(window: DateWindow | null, limit: number): Promise<QueryWorkout[]>;
  /** every working/warm-up set of one exercise (merged customs included) with their workouts */
  exerciseSets(exerciseId: string): Promise<{ workouts: QueryWorkout[]; sets: QuerySet[] }>;
  /** exercises the owner has logged, with set counts */
  knownExercises(): Promise<KnownExercise[]>;
}

// spelled out: drizzle renders a lone column unqualified on single-table selects,
// which inside these subqueries would bind to the inner table's id
const W_ID = sql.raw(`"lift_workouts"."id"`);

// lazy: tests mock @/lib/db without every table
const workoutCols = () => ({
  id: liftWorkouts.id,
  title: liftWorkouts.title,
  startedLocal: liftWorkouts.startedLocal,
  status: liftWorkouts.status,
  workingSets: liftWorkouts.workingSets,
  volumeKg: liftWorkouts.volumeKg,
  muscleLoad: liftWorkouts.muscleLoad,
  linkCount: sql<number>`(select count(*) from ${liftWorkoutActivities} wa where wa.workout_id = ${W_ID})`.mapWith(Number),
  // a public recording to point at, primary first; hidden ones never get linked
  publicActivityId: sql<number | null>`(select wa.activity_id from ${liftWorkoutActivities} wa join ${activities} a on a.id = wa.activity_id where wa.workout_id = ${W_ID} and a.hidden = false order by (wa.role = 'primary') desc, wa.activity_id limit 1)`.mapWith(
    (v: unknown) => (v === null || v === undefined ? null : Number(v)),
  ),
});

const live = () => and(isNull(liftWorkouts.deletedAt), ne(liftWorkouts.status, "discarded"));

function windowWhere(window: DateWindow | null): SQL | undefined {
  // started_local is wall-clock text, so a date range is a string range
  return window ? and(gte(liftWorkouts.startedLocal, window.start), lt(liftWorkouts.startedLocal, window.end)) : undefined;
}

function asWorkout(r: Record<string, unknown>): QueryWorkout {
  return {
    id: String(r.id),
    title: String(r.title ?? ""),
    startedLocal: String(r.startedLocal ?? ""),
    status: String(r.status ?? ""),
    workingSets: Number(r.workingSets) || 0,
    volumeKg: Number(r.volumeKg) || 0,
    muscleLoad: (r.muscleLoad && typeof r.muscleLoad === "object" ? r.muscleLoad : {}) as Record<string, number>,
    exerciseNames: Array.isArray(r.exerciseNames) ? r.exerciseNames.map(String) : [],
    unit: typeof r.unit === "string" ? r.unit : null,
    linkCount: Number(r.linkCount) || 0,
    publicActivityId: typeof r.publicActivityId === "number" ? r.publicActivityId : null,
  };
}

export const dbStore: QueryStore = {
  async workouts(window, limit) {
    const rows = await getDb()
      .select({
        ...workoutCols(),
        exerciseNames: sql<string[]>`(select coalesce(json_agg(e.name_raw order by e.position), '[]'::json) from ${liftWorkoutExercises} e where e.workout_id = ${W_ID})`,
        unit: sql<string | null>`(select s.unit from ${liftSets} s join ${liftWorkoutExercises} e on e.id = s.workout_exercise_id where e.workout_id = ${W_ID} and s.unit is not null group by s.unit order by count(*) desc, s.unit limit 1)`,
      })
      .from(liftWorkouts)
      .where(and(live(), windowWhere(window)))
      .orderBy(desc(liftWorkouts.startedLocal))
      .limit(limit);
    return rows.map(asWorkout);
  },

  async exerciseSets(exerciseId) {
    const rows = await getDb()
      .select({
        ...workoutCols(),
        exercisePosition: liftWorkoutExercises.position,
        position: liftSets.position,
        kind: liftSets.kind,
        weight: liftSets.weight,
        unit: liftSets.unit,
        reps: liftSets.reps,
        durationS: liftSets.durationS,
        distanceM: liftSets.distanceM,
        bodyweight: liftSets.bodyweight,
        completed: liftSets.completed,
      })
      .from(liftSets)
      .innerJoin(liftWorkoutExercises, eq(liftWorkoutExercises.id, liftSets.workoutExerciseId))
      .innerJoin(liftWorkouts, eq(liftWorkouts.id, liftWorkoutExercises.workoutId))
      .innerJoin(exercises, eq(exercises.id, liftWorkoutExercises.exerciseId))
      // rows of a custom exercise folded into this one still point at the old id
      .where(and(live(), or(eq(liftWorkoutExercises.exerciseId, exerciseId), eq(exercises.mergedInto, exerciseId))))
      .orderBy(asc(liftWorkouts.startedLocal), asc(liftWorkoutExercises.position), asc(liftSets.position));

    const workouts = new Map<string, QueryWorkout>();
    const sets: QuerySet[] = [];
    for (const r of rows) {
      if (!workouts.has(r.id)) workouts.set(r.id, asWorkout({ ...r, exerciseNames: [], unit: null }));
      sets.push({
        workoutId: r.id,
        exercisePosition: r.exercisePosition,
        position: r.position,
        kind: r.kind,
        weight: r.weight,
        unit: r.unit,
        reps: r.reps,
        durationS: r.durationS,
        distanceM: r.distanceM,
        bodyweight: r.bodyweight,
        completed: r.completed,
      });
    }
    return { workouts: [...workouts.values()], sets };
  },

  async knownExercises() {
    const rows = await getDb()
      .select({
        id: exercises.id,
        name: exercises.name,
        uses: sql<number>`count(*)`.mapWith(Number),
      })
      .from(liftWorkoutExercises)
      .innerJoin(exercises, eq(exercises.id, liftWorkoutExercises.exerciseId))
      .groupBy(exercises.id, exercises.name);
    return rows;
  },
};
