// workout repository. the expo-sqlite drizzle driver is synchronous, so these
// are plain sync functions: every write is committed (with its outbox row)
// before the call returns, and nothing about a set lives only in memory.

import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { randomUUID } from "expo-crypto";
import type { SetKind, WeightUnit } from "lift-core";
import { db, type Tx } from "./client";
import { notify } from "./events";
import { writeOutbox } from "./outbox";
import { sets, workoutExercises, workouts, type SetRow, type WorkoutExerciseRow, type WorkoutRow } from "./schema";
import { decideFinish, type FinishDecision } from "../lib/finish";
import { defaultWorkoutTitle } from "../lib/format";
import { byPosition, lastByPosition, nextPosition, prefillSet } from "../lib/sets";

function write<T>(fn: (tx: Tx) => T): T {
  const result = db.transaction(fn);
  notify();
  return result;
}

export interface WorkoutDetail {
  workout: WorkoutRow;
  exercises: { row: WorkoutExerciseRow; sets: SetRow[] }[];
}

/** the open workout, if any. used on launch to reopen it after the app was killed. */
export function getActiveWorkout(): WorkoutRow | undefined {
  return db.select().from(workouts).where(eq(workouts.status, "active")).orderBy(desc(workouts.startedAt)).get();
}

/** starts a workout, or returns the active one: only one can be open at a time */
export function startWorkout(now = Date.now()): WorkoutRow {
  return write((tx) => {
    const existing = tx.select().from(workouts).where(eq(workouts.status, "active")).get();
    if (existing) return existing;
    const row = tx
      .insert(workouts)
      .values({
        id: randomUUID(),
        title: defaultWorkoutTitle(new Date(now)),
        startedAt: now,
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    writeOutbox(tx, "workout", row.id, "insert", row);
    return row;
  });
}

export function getWorkoutDetail(workoutId: string): WorkoutDetail | undefined {
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
    exercises: exRows.map((row) => ({
      row,
      sets: setRows.filter((s) => s.workoutExerciseId === row.id).sort(byPosition),
    })),
  };
}

function insertSet(tx: Tx, workoutExerciseId: string, now: number): SetRow {
  const own = tx.select().from(sets).where(eq(sets.workoutExerciseId, workoutExerciseId)).all();
  let previous: SetRow | undefined = lastByPosition(own);
  if (!previous) {
    // first set of a repeated exercise: borrow from its earlier entry in this workout
    const we = tx.select().from(workoutExercises).where(eq(workoutExercises.id, workoutExerciseId)).get();
    if (we) {
      const siblings = tx
        .select({ s: sets, pos: workoutExercises.position })
        .from(sets)
        .innerJoin(workoutExercises, eq(sets.workoutExerciseId, workoutExercises.id))
        .where(and(eq(workoutExercises.workoutId, we.workoutId), eq(workoutExercises.exerciseId, we.exerciseId)))
        .orderBy(desc(workoutExercises.position), desc(sets.position))
        .get();
      previous = siblings?.s;
    }
  }
  const values = prefillSet(previous);
  const row = tx
    .insert(sets)
    .values({
      id: randomUUID(),
      workoutExerciseId,
      position: nextPosition(own),
      ...values,
      completed: 0,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
  writeOutbox(tx, "set", row.id, "insert", row);
  return row;
}

/** appends an exercise with one prefilled set, ready to log */
export function addExercise(workoutId: string, exerciseId: string, now = Date.now()): WorkoutExerciseRow {
  return write((tx) => {
    const existing = tx
      .select({ position: workoutExercises.position })
      .from(workoutExercises)
      .where(eq(workoutExercises.workoutId, workoutId))
      .all();
    const row = tx
      .insert(workoutExercises)
      .values({
        id: randomUUID(),
        workoutId,
        exerciseId,
        position: nextPosition(existing),
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    writeOutbox(tx, "workout_exercise", row.id, "insert", row);
    insertSet(tx, row.id, now);
    return row;
  });
}

export function addSet(workoutExerciseId: string, now = Date.now()): SetRow {
  return write((tx) => insertSet(tx, workoutExerciseId, now));
}

export interface SetPatch {
  kind?: SetKind;
  weight?: number | null;
  unit?: WeightUnit;
  reps?: number | null;
  durationS?: number | null;
  distanceM?: number | null;
  rpe?: number | null;
  note?: string | null;
  completed?: boolean;
}

export function updateSet(setId: string, patch: SetPatch, now = Date.now()): SetRow | undefined {
  const { completed, ...rest } = patch;
  return write((tx) => {
    const row = tx
      .update(sets)
      .set({ ...rest, ...(completed === undefined ? {} : { completed: completed ? 1 : 0 }), updatedAt: now })
      .where(eq(sets.id, setId))
      .returning()
      .get();
    if (row) writeOutbox(tx, "set", row.id, "update", row);
    return row;
  });
}

export function toggleComplete(setId: string, now = Date.now()): SetRow | undefined {
  const current = db.select({ completed: sets.completed }).from(sets).where(eq(sets.id, setId)).get();
  if (!current) return undefined;
  return updateSet(setId, { completed: !current.completed }, now);
}

/** positions are left with a gap: order is all they encode, and renumbering would spam the outbox */
export function deleteSet(setId: string): void {
  write((tx) => {
    const gone = tx.delete(sets).where(eq(sets.id, setId)).returning({ id: sets.id }).get();
    if (gone) writeOutbox(tx, "set", setId, "delete", { id: setId });
  });
}

function closeWorkout(tx: Tx, workoutId: string, status: "finished" | "discarded", now: number): void {
  const row = tx
    .update(workouts)
    .set({ status, endedAt: now, updatedAt: now })
    .where(and(eq(workouts.id, workoutId), eq(workouts.status, "active")))
    .returning()
    .get();
  if (row) writeOutbox(tx, "workout", row.id, "update", row);
}

/** soft: rows stay (status 'discarded') so an accidental discard is recoverable later */
export function discardWorkout(workoutId: string, now = Date.now()): void {
  write((tx) => closeWorkout(tx, workoutId, "discarded", now));
}

/** finishes, or discards when no set was completed. returns which happened. */
export function finishWorkout(workoutId: string, now = Date.now()): FinishDecision {
  return write((tx) => {
    const done = tx
      .select({ completed: sets.completed })
      .from(sets)
      .innerJoin(workoutExercises, eq(sets.workoutExerciseId, workoutExercises.id))
      .where(eq(workoutExercises.workoutId, workoutId))
      .all();
    const decision = decideFinish(done);
    closeWorkout(tx, workoutId, decision === "finish" ? "finished" : "discarded", now);
    return decision;
  });
}
