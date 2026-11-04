// workout repository. the expo-sqlite drizzle driver is synchronous, so these
// are plain sync functions: every write is committed (with its outbox row)
// before the call returns, and nothing about a set lives only in memory.

import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";
import { randomUUID } from "expo-crypto";
import type { SetKind, WeightUnit } from "lift-core";
import { db, type Db, type Tx } from "./client";

// reads that run both inside a write transaction and outside one
type Reader = Pick<Db, "select">;
import { notify } from "./events";
import { writeOutbox } from "./outbox";
import { getDefaultUnit } from "./settings";
import { sets, workoutExercises, workouts, type SetRow, type WorkoutExerciseRow, type WorkoutRow } from "./schema";
import { planFinish, type FinishDecision } from "../lib/finish";
import { defaultWorkoutTitle } from "../lib/format";
import { clampRestS } from "../lib/rest";
import {
  byPosition,
  diffExercises,
  lastByPosition,
  linkWithNext,
  moveExercise,
  nextPosition,
  normalizeGroups,
  pickPrevious,
  prefillSet,
  unlinkFromNext,
  type OrderedExercise,
} from "../lib/sets";

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
    const started = new Date(now);
    const row = tx
      .insert(workouts)
      .values({
        id: randomUUID(),
        title: defaultWorkoutTitle(started),
        startedAt: now,
        // getTimezoneOffset is minutes west of utc; the payload wants east
        utcOffsetMin: -started.getTimezoneOffset(),
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

function exerciseRows(q: Reader, workoutId: string): WorkoutExerciseRow[] {
  return q
    .select()
    .from(workoutExercises)
    .where(eq(workoutExercises.workoutId, workoutId))
    .orderBy(asc(workoutExercises.position))
    .all();
}

export function getWorkoutDetail(workoutId: string): WorkoutDetail | undefined {
  const workout = db.select().from(workouts).where(eq(workouts.id, workoutId)).get();
  if (!workout) return undefined;
  const exRows = exerciseRows(db, workoutId);
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

/**
 * completed sets of `exerciseId` from the most recent finished workout other
 * than `excludeWorkoutId`. if that session logged the exercise twice, the
 * first entry is the one compared against.
 */
function previousSessionSets(q: Reader, exerciseId: string, excludeWorkoutId: string): SetRow[] {
  const last = q
    .select({ id: workoutExercises.id })
    .from(workoutExercises)
    .innerJoin(workouts, eq(workoutExercises.workoutId, workouts.id))
    .where(
      and(
        eq(workoutExercises.exerciseId, exerciseId),
        eq(workouts.status, "finished"),
        ne(workouts.id, excludeWorkoutId)
      )
    )
    .orderBy(desc(workouts.startedAt), asc(workoutExercises.position))
    .get();
  if (!last) return [];
  return q
    .select()
    .from(sets)
    .where(and(eq(sets.workoutExerciseId, last.id), eq(sets.completed, 1)))
    .orderBy(asc(sets.position))
    .all();
}

/** previous-session sets per exercise id, for the "prev" ghost text */
export function getPreviousSessions(workoutId: string, exerciseIds: readonly string[]): Record<string, SetRow[]> {
  const out: Record<string, SetRow[]> = {};
  for (const id of new Set(exerciseIds)) out[id] = previousSessionSets(db, id, workoutId);
  return out;
}

function insertSet(tx: Tx, workoutExerciseId: string, now: number): SetRow {
  const own = tx.select().from(sets).where(eq(sets.workoutExerciseId, workoutExerciseId)).all();
  let previous: Parameters<typeof prefillSet>[0] = lastByPosition(own);
  if (!previous) {
    const we = tx.select().from(workoutExercises).where(eq(workoutExercises.id, workoutExerciseId)).get();
    if (we) {
      // first set of a repeated exercise: borrow from its earlier entry in this workout
      const sibling = tx
        .select({ s: sets, pos: workoutExercises.position })
        .from(sets)
        .innerJoin(workoutExercises, eq(sets.workoutExerciseId, workoutExercises.id))
        .where(and(eq(workoutExercises.workoutId, we.workoutId), eq(workoutExercises.exerciseId, we.exerciseId)))
        .orderBy(desc(workoutExercises.position), desc(sets.position))
        .get();
      // nothing yet this workout: start from what was lifted last session
      previous = sibling?.s ?? pickPrevious(previousSessionSets(tx, we.exerciseId, we.workoutId), own.length);
    }
  }
  const values = prefillSet(previous, getDefaultUnit());
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

function deleteSetTx(tx: Tx, setId: string): void {
  const gone = tx.delete(sets).where(eq(sets.id, setId)).returning({ id: sets.id }).get();
  if (gone) writeOutbox(tx, "set", setId, "delete", { id: setId });
}

/** positions are left with a gap: order is all they encode, and renumbering would spam the outbox */
export function deleteSet(setId: string): void {
  write((tx) => deleteSetTx(tx, setId));
}

function patchExercise(
  tx: Tx,
  id: string,
  patch: Partial<Pick<WorkoutExerciseRow, "position" | "supersetGroup" | "restS" | "notes" | "exerciseId">>,
  now: number
): WorkoutExerciseRow | undefined {
  const row = tx
    .update(workoutExercises)
    .set({ ...patch, updatedAt: now })
    .where(eq(workoutExercises.id, id))
    .returning()
    .get();
  if (row) writeOutbox(tx, "workout_exercise", row.id, "update", row);
  return row;
}

/** null restores the app default */
export function setExerciseRest(workoutExerciseId: string, restS: number | null, now = Date.now()): void {
  write((tx) => patchExercise(tx, workoutExerciseId, { restS: restS == null ? null : clampRestS(restS) }, now));
}

/** swaps the exercise but keeps its logged sets, for "the rack was taken" */
export function replaceExercise(workoutExerciseId: string, exerciseId: string, now = Date.now()): void {
  write((tx) => patchExercise(tx, workoutExerciseId, { exerciseId }, now));
}

function relayout(
  tx: Tx,
  workoutId: string,
  op: (list: OrderedExercise[]) => OrderedExercise[],
  now: number
): void {
  const before = exerciseRows(tx, workoutId).map(({ id, position, supersetGroup }) => ({ id, position, supersetGroup }));
  for (const p of diffExercises(before, op(before))) {
    patchExercise(tx, p.id, { position: p.position, supersetGroup: p.supersetGroup }, now);
  }
}

function indexIn(tx: Tx, workoutId: string, workoutExerciseId: string): number {
  return exerciseRows(tx, workoutId).findIndex((e) => e.id === workoutExerciseId);
}

export function moveWorkoutExercise(workoutId: string, workoutExerciseId: string, dir: -1 | 1, now = Date.now()): void {
  write((tx) => {
    const i = indexIn(tx, workoutId, workoutExerciseId);
    if (i >= 0) relayout(tx, workoutId, (l) => moveExercise(l, i, dir), now);
  });
}

/** superset this exercise with the one below it */
export function linkWithNextExercise(workoutId: string, workoutExerciseId: string, now = Date.now()): void {
  write((tx) => {
    const i = indexIn(tx, workoutId, workoutExerciseId);
    if (i >= 0) relayout(tx, workoutId, (l) => linkWithNext(l, i), now);
  });
}

export function unlinkFromNextExercise(workoutId: string, workoutExerciseId: string, now = Date.now()): void {
  write((tx) => {
    const i = indexIn(tx, workoutId, workoutExerciseId);
    if (i >= 0) relayout(tx, workoutId, (l) => unlinkFromNext(l, i), now);
  });
}

function deleteExerciseTx(tx: Tx, workoutExerciseId: string): void {
  // explicit set deletes first: the fk cascade would remove them without outbox rows
  const own = tx.select({ id: sets.id }).from(sets).where(eq(sets.workoutExerciseId, workoutExerciseId)).all();
  for (const s of own) deleteSetTx(tx, s.id);
  const gone = tx
    .delete(workoutExercises)
    .where(eq(workoutExercises.id, workoutExerciseId))
    .returning({ id: workoutExercises.id })
    .get();
  if (gone) writeOutbox(tx, "workout_exercise", workoutExerciseId, "delete", { id: workoutExerciseId });
}

export function removeExercise(workoutId: string, workoutExerciseId: string, now = Date.now()): void {
  write((tx) => {
    deleteExerciseTx(tx, workoutExerciseId);
    // a superset of two loses its partner: the survivor drops its group
    relayout(tx, workoutId, normalizeGroups, now);
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

/**
 * finishes, or discards when no set was completed. a finish drops unchecked
 * sets (and exercises left empty) so history only holds what was lifted.
 */
export function finishWorkout(workoutId: string, now = Date.now()): FinishDecision {
  return write((tx) => {
    const exRows = exerciseRows(tx, workoutId);
    const setRows = exRows.length
      ? tx
          .select({ id: sets.id, completed: sets.completed, workoutExerciseId: sets.workoutExerciseId })
          .from(sets)
          .where(
            inArray(
              sets.workoutExerciseId,
              exRows.map((e) => e.id)
            )
          )
          .all()
      : [];
    const plan = planFinish(exRows.map((e) => ({ id: e.id, sets: setRows.filter((s) => s.workoutExerciseId === e.id) })));
    for (const id of plan.deleteSetIds) deleteSetTx(tx, id);
    for (const id of plan.deleteExerciseIds) deleteExerciseTx(tx, id);
    if (plan.deleteExerciseIds.length) relayout(tx, workoutId, normalizeGroups, now);
    closeWorkout(tx, workoutId, plan.decision === "finish" ? "finished" : "discarded", now);
    return plan.decision;
  });
}
