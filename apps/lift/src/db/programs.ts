// program repository. same rules as templates.ts: every write commits with
// its outbox row (the full row after the write) before returning.

import { and, asc, desc, eq, inArray, isNotNull, ne } from "drizzle-orm";
import { randomUUID } from "expo-crypto";
import {
  emptyProgram,
  parseProgramData,
  programProgress,
  serializeProgramData,
  type ProgramData,
  type ProgramProgress,
  type SessionSet,
} from "lift-core";
import { db, type Db, type Tx } from "./client";
import { notify } from "./events";
import { writeOutbox } from "./outbox";
import { programs, sets, templateExercises, workoutExercises, workouts, type ProgramRow, type WorkoutRow } from "./schema";
import { getPreferredUnit } from "./bodyweight";
import { startWorkoutFromTemplate } from "./templates";
import { bumpedAt } from "../lib/clock";
import { validateName } from "../lib/names";
import { plannedWithTarget, targetFromHistory } from "../lib/programs";

type Reader = Pick<Db, "select">;

function write<T>(fn: (tx: Tx) => T): T {
  const result = db.transaction(fn);
  notify();
  return result;
}

function checkedName(raw: string): string {
  const v = validateName(raw);
  if (!v.ok) throw new Error(v.error);
  return v.name;
}

export interface ProgramDetail {
  row: ProgramRow;
  data: ProgramData;
}

const detail = (row: ProgramRow): ProgramDetail => ({ row, data: parseProgramData(row.data) });

export function listPrograms(): ProgramDetail[] {
  return db
    .select()
    .from(programs)
    .all()
    .sort((a, b) => b.active - a.active || a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    .map(detail);
}

export function getProgram(id: string): ProgramDetail | undefined {
  const row = db.select().from(programs).where(eq(programs.id, id)).get();
  return row ? detail(row) : undefined;
}

export function getActiveProgram(): ProgramDetail | undefined {
  const row = db.select().from(programs).where(eq(programs.active, 1)).orderBy(desc(programs.updatedAt)).get();
  return row ? detail(row) : undefined;
}

export function createProgram(name: string, data: ProgramData = emptyProgram(4, 3), now = Date.now()): ProgramRow {
  const clean = checkedName(name);
  return write((tx) => {
    const row = tx
      .insert(programs)
      .values({ id: randomUUID(), name: clean, data: serializeProgramData(data), active: 0, createdAt: now, updatedAt: now })
      .returning()
      .get();
    writeOutbox(tx, "program", row.id, "insert", row);
    return row;
  });
}

function update(tx: Tx, current: ProgramRow, patch: { name?: string; data?: ProgramData; active?: 0 | 1 }, now: number): ProgramRow {
  const name = patch.name ?? current.name;
  const data = patch.data ? serializeProgramData(patch.data) : current.data;
  const active = patch.active ?? (current.active ? 1 : 0);
  // an unchanged save writes nothing, so it doesn't sync a no-op
  if (name === current.name && data === current.data && active === current.active) return current;
  const row = tx
    .update(programs)
    .set({ name, data, active, updatedAt: bumpedAt(programs.updatedAt, now) })
    .where(eq(programs.id, current.id))
    .returning()
    .get()!;
  writeOutbox(tx, "program", row.id, "update", row);
  return row;
}

export function saveProgram(id: string, input: { name: string; data: ProgramData }, now = Date.now()): ProgramRow | undefined {
  const name = checkedName(input.name);
  return write((tx) => {
    const current = tx.select().from(programs).where(eq(programs.id, id)).get();
    return current ? update(tx, current, { name, data: input.data }, now) : undefined;
  });
}

/**
 * makes this the one active program (or none). a program that never ran
 * starts counting now, so older workouts of the same templates don't count.
 */
export function setActiveProgram(id: string | null, now = Date.now()): void {
  write((tx) => {
    for (const other of tx.select().from(programs).where(eq(programs.active, 1)).all()) {
      if (other.id !== id) update(tx, other, { active: 0 }, now);
    }
    if (!id) return;
    const current = tx.select().from(programs).where(eq(programs.id, id)).get();
    if (!current) return;
    const data = parseProgramData(current.data);
    update(tx, current, { active: 1, data: data.startedAt == null ? { ...data, startedAt: now } : data }, now);
  });
}

/** back to week 1 day 1, counting from now */
export function restartProgram(id: string, now = Date.now()): void {
  write((tx) => {
    const current = tx.select().from(programs).where(eq(programs.id, id)).get();
    if (current) update(tx, current, { data: { ...parseProgramData(current.data), startedAt: now, skipped: 0 } }, now);
  });
}

/** move past the next day without logging it */
export function skipProgramDay(id: string, now = Date.now()): void {
  write((tx) => {
    const current = tx.select().from(programs).where(eq(programs.id, id)).get();
    if (!current) return;
    const data = parseProgramData(current.data);
    update(tx, current, { data: { ...data, skipped: data.skipped + 1 } }, now);
  });
}

export function deleteProgram(id: string): void {
  write((tx) => {
    const gone = tx.delete(programs).where(eq(programs.id, id)).returning({ id: programs.id }).get();
    if (gone) writeOutbox(tx, "program", id, "delete", { id });
  });
}

// ---------------------------------------------------------------------------
// progress + history reads

/** finished template workouts since `since`, oldest first */
export function completedTemplateWorkouts(since: number | null, q: Reader = db): { templateId: string | null; startedAt: number }[] {
  const where = and(eq(workouts.status, "finished"), isNotNull(workouts.templateId));
  return q
    .select({ templateId: workouts.templateId, startedAt: workouts.startedAt })
    .from(workouts)
    .where(where)
    .orderBy(asc(workouts.startedAt))
    .all()
    .filter((w) => since == null || w.startedAt >= since);
}

export function getProgramProgress(p: Pick<ProgramDetail, "data">, q: Reader = db): ProgramProgress {
  return programProgress(p.data, completedTemplateWorkouts(p.data.startedAt, q));
}

/**
 * completed sets of the last `n` finished sessions of an exercise, newest
 * first, leaving out `excludeWorkoutId`. one entry per workout (its first).
 */
export function recentSessions(exerciseId: string, excludeWorkoutId: string | null, n = 5, q: Reader = db): SessionSet[][] {
  const rows = q
    .select({ id: workoutExercises.id, workoutId: workoutExercises.workoutId })
    .from(workoutExercises)
    .innerJoin(workouts, eq(workoutExercises.workoutId, workouts.id))
    .where(
      and(
        eq(workoutExercises.exerciseId, exerciseId),
        eq(workouts.status, "finished"),
        excludeWorkoutId ? ne(workouts.id, excludeWorkoutId) : undefined
      )
    )
    .orderBy(desc(workouts.startedAt), asc(workoutExercises.position))
    .limit(n * 3)
    .all();
  const picked: string[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.workoutId)) continue;
    seen.add(r.workoutId);
    picked.push(r.id);
    if (picked.length >= n) break;
  }
  if (!picked.length) return [];
  const setRows = q
    .select()
    .from(sets)
    .where(and(inArray(sets.workoutExerciseId, picked), eq(sets.completed, 1)))
    .orderBy(asc(sets.position))
    .all();
  return picked.map((weId) => setRows.filter((s) => s.workoutExerciseId === weId));
}

/** template exercise ids + exercise ids of a template, in order */
export function templateExerciseRefs(templateId: string, q: Reader = db): { id: string; exerciseId: string }[] {
  return q
    .select({ id: templateExercises.id, exerciseId: templateExercises.exerciseId })
    .from(templateExercises)
    .where(eq(templateExercises.templateId, templateId))
    .orderBy(asc(templateExercises.position))
    .all();
}

export type StartProgramDayResult =
  | { kind: "started" | "in_progress"; workout: WorkoutRow }
  | { kind: "done" | "missing_template" | "not_found" };

/**
 * one tap from home: start the program's next day from its template, with
 * each ruled exercise's working sets set by its progression rule
 */
export function startNextProgramDay(id: string, now = Date.now()): StartProgramDayResult {
  const program = getProgram(id);
  if (!program) return { kind: "not_found" };
  const next = getProgramProgress(program).next;
  if (!next) return { kind: "done" };
  const unit = getPreferredUnit();
  const result = startWorkoutFromTemplate(next.templateId, now, {
    plannedFor: (te, planned, tx) => {
      const rule = program.data.rules[te.id];
      if (!rule) return planned;
      return plannedWithTarget(planned, targetFromHistory(rule, recentSessions(te.exerciseId, null, 5, tx), unit));
    },
  });
  if (!result) return { kind: "missing_template" };
  return { kind: result.started ? "started" : "in_progress", workout: result.workout };
}

/** the program whose rules apply to a workout of this template: the active one if it uses it */
export function programForTemplate(templateId: string | null): ProgramDetail | undefined {
  if (!templateId) return undefined;
  const active = getActiveProgram();
  if (active && active.data.weeks.some((w) => w.days.some((d) => d.templateId === templateId))) return active;
  return undefined;
}
