// read side of finished workouts: history list, per-exercise sets for charts
// and prs, and the soft delete.

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { HistorySet, WeightUnit } from "lift-core";
import { db } from "./client";
import { notify } from "./events";
import { bumpedAt } from "../lib/clock";
import { writeOutbox } from "./outbox";
import { getDefaultUnit } from "./settings";
import { sets, workoutExercises, workouts, type SetRow, type WorkoutExerciseRow, type WorkoutRow } from "./schema";
import type { NoteRow } from "../lib/records";

export function getUnit(): WeightUnit {
  return getDefaultUnit();
}

/** every set of one exercise across finished workouts, flattened for lift-core history math */
export function loadExerciseHistory(exerciseId: string): HistorySet[] {
  const rows = db
    .select({
      workoutId: workouts.id,
      startedAt: workouts.startedAt,
      exerciseId: workoutExercises.exerciseId,
      kind: sets.kind,
      weight: sets.weight,
      unit: sets.unit,
      reps: sets.reps,
      completed: sets.completed,
    })
    .from(sets)
    .innerJoin(workoutExercises, eq(sets.workoutExerciseId, workoutExercises.id))
    .innerJoin(workouts, eq(workoutExercises.workoutId, workouts.id))
    .where(and(eq(workouts.status, "finished"), eq(workoutExercises.exerciseId, exerciseId)))
    .orderBy(asc(workouts.startedAt), asc(workoutExercises.position), asc(sets.position))
    .all();
  return rows.map((r) => ({ ...r, completed: r.completed === 1 }));
}

export interface WorkoutListItem {
  workout: WorkoutRow;
  /** completed working sets */
  sets: number;
  volumeKg: number;
  exercises: number;
}

// lb -> kg inside sql so the list is one grouped query
const KG = sql<number>`coalesce(sum(case
  when ${sets.completed} = 1 and ${sets.kind} != 'warmup' and ${sets.weight} > 0 and ${sets.reps} > 0
  then ${sets.weight} * ${sets.reps} * (case when ${sets.unit} = 'kg' then 1.0 else 1.0 / 2.2046226218 end)
  else 0 end), 0)`;
const WORKING = sql<number>`coalesce(sum(case when ${sets.completed} = 1 and ${sets.kind} != 'warmup' then 1 else 0 end), 0)`;

export function listFinishedWorkouts(): WorkoutListItem[] {
  const list = db
    .select()
    .from(workouts)
    .where(eq(workouts.status, "finished"))
    .orderBy(desc(workouts.startedAt))
    .all();
  if (list.length === 0) return [];
  const agg = db
    .select({
      workoutId: workoutExercises.workoutId,
      sets: WORKING,
      volumeKg: KG,
      exercises: sql<number>`count(distinct ${workoutExercises.id})`,
    })
    .from(workoutExercises)
    .innerJoin(workouts, eq(workoutExercises.workoutId, workouts.id))
    .leftJoin(sets, eq(sets.workoutExerciseId, workoutExercises.id))
    .where(eq(workouts.status, "finished"))
    .groupBy(workoutExercises.workoutId)
    .all();
  const byId = new Map(agg.map((a) => [a.workoutId, a]));
  return list.map((workout) => {
    const a = byId.get(workout.id);
    return {
      workout,
      sets: Number(a?.sets ?? 0),
      volumeKg: Number(a?.volumeKg ?? 0),
      exercises: Number(a?.exercises ?? 0),
    };
  });
}

export interface HistoryDetail {
  workout: WorkoutRow;
  exercises: { row: WorkoutExerciseRow; sets: SetRow[] }[];
}

export function getHistoryDetail(workoutId: string): HistoryDetail | undefined {
  const workout = db.select().from(workouts).where(eq(workouts.id, workoutId)).get();
  if (!workout) return undefined;
  const exRows = db
    .select()
    .from(workoutExercises)
    .where(eq(workoutExercises.workoutId, workoutId))
    .orderBy(asc(workoutExercises.position))
    .all();
  const setRows = exRows.length
    ? db
        .select()
        .from(sets)
        .where(
          inArray(
            sets.workoutExerciseId,
            exRows.map((e) => e.id)
          )
        )
        .orderBy(asc(sets.position))
        .all()
    : [];
  return {
    workout,
    exercises: exRows.map((row) => ({ row, sets: setRows.filter((s) => s.workoutExerciseId === row.id) })),
  };
}

/** soft delete: status 'discarded' plus an outbox update, so the server drops it too and nothing is lost */
export function deleteFinishedWorkout(workoutId: string, now = Date.now()): boolean {
  const row = db.transaction((tx) => {
    const updated = tx
      .update(workouts)
      .set({ status: "discarded", updatedAt: bumpedAt(workouts.updatedAt, now) })
      .where(and(eq(workouts.id, workoutId), eq(workouts.status, "finished")))
      .returning()
      .get();
    if (updated) writeOutbox(tx, "workout", updated.id, "update", updated);
    return updated;
  });
  notify();
  return Boolean(row);
}

/** like loadExerciseHistory, for several exercises at once (summary prs) */
export function loadHistoryFor(exerciseIds: readonly string[]): HistorySet[] {
  if (exerciseIds.length === 0) return [];
  const rows = db
    .select({
      workoutId: workouts.id,
      startedAt: workouts.startedAt,
      exerciseId: workoutExercises.exerciseId,
      kind: sets.kind,
      weight: sets.weight,
      unit: sets.unit,
      reps: sets.reps,
      completed: sets.completed,
    })
    .from(sets)
    .innerJoin(workoutExercises, eq(sets.workoutExerciseId, workoutExercises.id))
    .innerJoin(workouts, eq(workoutExercises.workoutId, workouts.id))
    .where(and(eq(workouts.status, "finished"), inArray(workoutExercises.exerciseId, [...new Set(exerciseIds)])))
    .orderBy(asc(workouts.startedAt), asc(workoutExercises.position), asc(sets.position))
    .all();
  return rows.map((r) => ({ ...r, completed: r.completed === 1 }));
}

/** card notes and set notes of one exercise across finished workouts, one row per entry */
export function loadExerciseNotes(exerciseId: string): NoteRow[] {
  const entries = db
    .select({ id: workoutExercises.id, notes: workoutExercises.notes, workoutId: workouts.id, startedAt: workouts.startedAt })
    .from(workoutExercises)
    .innerJoin(workouts, eq(workoutExercises.workoutId, workouts.id))
    .where(and(eq(workouts.status, "finished"), eq(workoutExercises.exerciseId, exerciseId)))
    .orderBy(desc(workouts.startedAt), asc(workoutExercises.position))
    .all();
  if (entries.length === 0) return [];
  const setRows = db
    .select({ workoutExerciseId: sets.workoutExerciseId, position: sets.position, note: sets.note })
    .from(sets)
    .where(
      inArray(
        sets.workoutExerciseId,
        entries.map((e) => e.id)
      )
    )
    .orderBy(asc(sets.position))
    .all();
  return entries.map((e) => ({
    workoutId: e.workoutId,
    startedAt: e.startedAt,
    exerciseNote: e.notes,
    setNotes: setRows
      .filter((s) => s.workoutExerciseId === e.id)
      .map((s, i) => ({ setNumber: i + 1, text: s.note ?? "" }))
      .filter((s) => s.text.trim() !== ""),
  }));
}
