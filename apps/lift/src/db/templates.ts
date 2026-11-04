// template + folder repository. same rules as workouts.ts: sync writes, each
// committed with its outbox row (full row after the write) before returning.

import { asc, eq, inArray, isNull } from "drizzle-orm";
import { randomUUID } from "expo-crypto";
import { db, type Tx } from "./client";
import { notify } from "./events";
import { writeOutbox } from "./outbox";
import {
  sets,
  templateExercises,
  templateFolders,
  templates,
  workoutExercises,
  workouts,
  type TemplateExerciseRow,
  type TemplateFolderRow,
  type TemplateRow,
  type WorkoutRow,
} from "./schema";
import { getPreferredUnit } from "./bodyweight";
import { previousSessionSets } from "./workouts";
import { bumpedAt } from "../lib/clock";
import { copyName, validateName } from "../lib/names";
import { clampSetNumbers, clampTitle, cleanNote } from "../lib/numbers";
import { nextPosition } from "../lib/sets";
import {
  byPositionThenName,
  parsePlannedSets,
  planTemplateSave,
  plannedFromLogged,
  positionUpdates,
  serializePlannedSets,
  setsFromPlanned,
  type PlannedSet,
  type TemplateExerciseDraft,
} from "../lib/templates";

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

// ---------------------------------------------------------------------------
// folders

export function listFolders(): TemplateFolderRow[] {
  return db.select().from(templateFolders).all().sort(byPositionThenName);
}

export function createFolder(name: string, now = Date.now()): TemplateFolderRow {
  const clean = checkedName(name);
  return write((tx) => {
    const existing = tx.select({ position: templateFolders.position }).from(templateFolders).all();
    const row = tx
      .insert(templateFolders)
      .values({ id: randomUUID(), name: clean, position: nextPosition(existing), createdAt: now, updatedAt: now })
      .returning()
      .get();
    writeOutbox(tx, "template_folder", row.id, "insert", row);
    return row;
  });
}

export function renameFolder(id: string, name: string, now = Date.now()): TemplateFolderRow | undefined {
  const clean = checkedName(name);
  return write((tx) => {
    const row = tx
      .update(templateFolders)
      .set({ name: clean, updatedAt: bumpedAt(templateFolders.updatedAt, now) })
      .where(eq(templateFolders.id, id))
      .returning()
      .get();
    if (row) writeOutbox(tx, "template_folder", row.id, "update", row);
    return row;
  });
}

/** writes positions for the given order; only rows that moved get an outbox row */
export function reorderFolders(orderedIds: readonly string[], now = Date.now()): void {
  write((tx) => {
    const rows = tx.select().from(templateFolders).all();
    const byId = new Map(rows.map((r) => [r.id, r]));
    const ordered = orderedIds.map((id) => byId.get(id)).filter((r): r is TemplateFolderRow => !!r);
    for (const u of positionUpdates(ordered)) {
      const row = tx
        .update(templateFolders)
        .set({ position: u.position, updatedAt: bumpedAt(templateFolders.updatedAt, now) })
        .where(eq(templateFolders.id, u.id))
        .returning()
        .get();
      if (row) writeOutbox(tx, "template_folder", row.id, "update", row);
    }
  });
}

/** its templates become unfiled; done by hand (not the fk) so each gets an outbox row */
export function deleteFolder(id: string, now = Date.now()): void {
  write((tx) => {
    const loose = tx.select({ position: templates.position }).from(templates).where(isNull(templates.folderId)).all();
    let pos = nextPosition(loose);
    const inside = tx.select().from(templates).where(eq(templates.folderId, id)).all().sort(byPositionThenName);
    for (const t of inside) {
      const row = tx
        .update(templates)
        .set({ folderId: null, position: pos++, updatedAt: bumpedAt(templates.updatedAt, now) })
        .where(eq(templates.id, t.id))
        .returning()
        .get();
      if (row) writeOutbox(tx, "template", row.id, "update", row);
    }
    const gone = tx.delete(templateFolders).where(eq(templateFolders.id, id)).returning({ id: templateFolders.id }).get();
    if (gone) writeOutbox(tx, "template_folder", id, "delete", { id });
  });
}

// ---------------------------------------------------------------------------
// templates

export function listTemplates(options: { includeArchived?: boolean } = {}): TemplateRow[] {
  const q = db.select().from(templates);
  const rows = options.includeArchived ? q.all() : q.where(eq(templates.archived, 0)).all();
  return rows.sort(byPositionThenName);
}

export function getTemplate(id: string): TemplateRow | undefined {
  return db.select().from(templates).where(eq(templates.id, id)).get();
}

export interface TemplateExerciseDetail {
  row: TemplateExerciseRow;
  planned: PlannedSet[];
}

export interface TemplateDetail {
  template: TemplateRow;
  exercises: TemplateExerciseDetail[];
}

export function getTemplateDetail(id: string): TemplateDetail | undefined {
  const template = getTemplate(id);
  if (!template) return undefined;
  const rows = db
    .select()
    .from(templateExercises)
    .where(eq(templateExercises.templateId, id))
    .orderBy(asc(templateExercises.position))
    .all();
  return { template, exercises: rows.map((row) => ({ row, planned: parsePlannedSets(row.plannedSets) })) };
}

/** exercise counts per template, for list subtitles */
export function templateExerciseCounts(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of db.select({ t: templateExercises.templateId }).from(templateExercises).all()) out[r.t] = (out[r.t] ?? 0) + 1;
  return out;
}

function nextTemplatePosition(tx: Tx, folderId: string | null): number {
  const where = folderId ? eq(templates.folderId, folderId) : isNull(templates.folderId);
  return nextPosition(tx.select({ position: templates.position }).from(templates).where(where).all());
}

function insertTemplate(
  tx: Tx,
  input: { name: string; notes?: string | null; folderId?: string | null },
  now: number
): TemplateRow {
  const folderId = input.folderId ?? null;
  const row = tx
    .insert(templates)
    .values({
      id: randomUUID(),
      folderId,
      name: input.name,
      notes: cleanNote(input.notes),
      position: nextTemplatePosition(tx, folderId),
      archived: 0,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
  writeOutbox(tx, "template", row.id, "insert", row);
  return row;
}

function insertTemplateExercise(
  tx: Tx,
  templateId: string,
  values: {
    exerciseId: string;
    position: number;
    supersetGroup: number | null;
    restS: number | null;
    plannedSets: string;
    notes: string | null;
  },
  now: number
): TemplateExerciseRow {
  const row = tx
    .insert(templateExercises)
    .values({ id: randomUUID(), templateId, ...values, createdAt: now, updatedAt: now })
    .returning()
    .get();
  writeOutbox(tx, "template_exercise", row.id, "insert", row);
  return row;
}

export function createTemplate(
  input: { name: string; notes?: string | null; folderId?: string | null },
  now = Date.now()
): TemplateRow {
  const name = checkedName(input.name);
  return write((tx) => insertTemplate(tx, { ...input, name }, now));
}

export interface TemplateDraft {
  name: string;
  notes: string | null;
  folderId: string | null;
  exercises: TemplateExerciseDraft[];
}

/** applies the whole editor draft: template fields plus exercise inserts/updates/deletes */
export function saveTemplate(id: string, draft: TemplateDraft, now = Date.now()): TemplateRow | undefined {
  const name = checkedName(draft.name);
  return write((tx) => {
    const current = tx.select().from(templates).where(eq(templates.id, id)).get();
    if (!current) return undefined;
    const notes = cleanNote(draft.notes);
    const folderId = draft.folderId ?? null;
    let row = current;
    if (current.name !== name || current.notes !== notes || current.folderId !== folderId) {
      const position = current.folderId === folderId ? current.position : nextTemplatePosition(tx, folderId);
      row = tx
        .update(templates)
        .set({ name, notes, folderId, position, updatedAt: bumpedAt(templates.updatedAt, now) })
        .where(eq(templates.id, id))
        .returning()
        .get()!;
      writeOutbox(tx, "template", row.id, "update", row);
    }
    const existing = tx.select().from(templateExercises).where(eq(templateExercises.templateId, id)).all();
    const plan = planTemplateSave(existing, draft.exercises);
    for (const delId of plan.deletes) {
      tx.delete(templateExercises).where(eq(templateExercises.id, delId)).run();
      writeOutbox(tx, "template_exercise", delId, "delete", { id: delId });
    }
    for (const { id: upId, ...values } of plan.updates) {
      const up = tx
        .update(templateExercises)
        .set({ ...values, updatedAt: bumpedAt(templateExercises.updatedAt, now) })
        .where(eq(templateExercises.id, upId))
        .returning()
        .get();
      if (up) writeOutbox(tx, "template_exercise", up.id, "update", up);
    }
    for (const values of plan.inserts) insertTemplateExercise(tx, id, values, now);
    return row;
  });
}

export function duplicateTemplate(id: string, now = Date.now()): TemplateRow | undefined {
  return write((tx) => {
    const src = tx.select().from(templates).where(eq(templates.id, id)).get();
    if (!src) return undefined;
    const names = tx.select({ name: templates.name }).from(templates).all().map((r) => r.name);
    const copy = insertTemplate(tx, { name: copyName(src.name, names), notes: src.notes, folderId: src.folderId }, now);
    const exs = tx.select().from(templateExercises).where(eq(templateExercises.templateId, id)).all();
    for (const e of exs) {
      insertTemplateExercise(
        tx,
        copy.id,
        {
          exerciseId: e.exerciseId,
          position: e.position,
          supersetGroup: e.supersetGroup,
          restS: e.restS,
          plannedSets: e.plannedSets,
          notes: e.notes,
        },
        now
      );
    }
    return copy;
  });
}

export function setTemplateArchived(id: string, archived: boolean, now = Date.now()): TemplateRow | undefined {
  return write((tx) => {
    const row = tx
      .update(templates)
      .set({ archived: archived ? 1 : 0, updatedAt: bumpedAt(templates.updatedAt, now) })
      .where(eq(templates.id, id))
      .returning()
      .get();
    if (row) writeOutbox(tx, "template", row.id, "update", row);
    return row;
  });
}

/** exercises are deleted first, each with its own outbox row, rather than via the cascade */
export function deleteTemplate(id: string): void {
  write((tx) => {
    const exs = tx.select({ id: templateExercises.id }).from(templateExercises).where(eq(templateExercises.templateId, id)).all();
    for (const e of exs) {
      tx.delete(templateExercises).where(eq(templateExercises.id, e.id)).run();
      writeOutbox(tx, "template_exercise", e.id, "delete", { id: e.id });
    }
    const gone = tx.delete(templates).where(eq(templates.id, id)).returning({ id: templates.id }).get();
    if (gone) writeOutbox(tx, "template", id, "delete", { id });
  });
}

/** positions within one folder, in the given order */
export function reorderTemplates(orderedIds: readonly string[], now = Date.now()): void {
  if (!orderedIds.length) return;
  write((tx) => {
    const rows = tx.select().from(templates).where(inArray(templates.id, [...orderedIds])).all();
    const byId = new Map(rows.map((r) => [r.id, r]));
    const ordered = orderedIds.map((id) => byId.get(id)).filter((r): r is TemplateRow => !!r);
    for (const u of positionUpdates(ordered)) {
      const row = tx
        .update(templates)
        .set({ position: u.position, updatedAt: bumpedAt(templates.updatedAt, now) })
        .where(eq(templates.id, u.id))
        .returning()
        .get();
      if (row) writeOutbox(tx, "template", row.id, "update", row);
    }
  });
}

export function moveTemplateToFolder(id: string, folderId: string | null, now = Date.now()): TemplateRow | undefined {
  return write((tx) => {
    const current = tx.select().from(templates).where(eq(templates.id, id)).get();
    if (!current || current.folderId === folderId) return current;
    const row = tx
      .update(templates)
      .set({ folderId, position: nextTemplatePosition(tx, folderId), updatedAt: bumpedAt(templates.updatedAt, now) })
      .where(eq(templates.id, id))
      .returning()
      .get();
    if (row) writeOutbox(tx, "template", row.id, "update", row);
    return row;
  });
}

// ---------------------------------------------------------------------------
// workouts <-> templates

/**
 * new template from a workout's exercises and sets. a finished workout keeps
 * only completed sets (exercises with none are dropped); an active one keeps all.
 */
export function templateFromWorkout(
  workoutId: string,
  name: string,
  options: { folderId?: string | null } = {},
  now = Date.now()
): TemplateRow | undefined {
  const clean = checkedName(name);
  return write((tx) => {
    const workout = tx.select().from(workouts).where(eq(workouts.id, workoutId)).get();
    if (!workout) return undefined;
    const onlyCompleted = workout.status !== "active";
    const exs = tx
      .select()
      .from(workoutExercises)
      .where(eq(workoutExercises.workoutId, workoutId))
      .orderBy(asc(workoutExercises.position))
      .all();
    const setRows = exs.length
      ? tx
          .select()
          .from(sets)
          .where(
            inArray(
              sets.workoutExerciseId,
              exs.map((e) => e.id)
            )
          )
          .all()
      : [];
    const template = insertTemplate(tx, { name: clean, notes: workout.notes, folderId: options.folderId ?? null }, now);
    let position = 0;
    for (const e of exs) {
      const planned = plannedFromLogged(
        setRows.filter((s) => s.workoutExerciseId === e.id),
        onlyCompleted
      );
      if (onlyCompleted && !planned.length) continue;
      insertTemplateExercise(
        tx,
        template.id,
        {
          exerciseId: e.exerciseId,
          position: position++,
          supersetGroup: e.supersetGroup,
          restS: e.restS,
          plannedSets: serializePlannedSets(planned),
          notes: e.notes,
        },
        now
      );
    }
    return template;
  });
}

export interface StartFromTemplateResult {
  workout: WorkoutRow;
  /** false when a workout was already active; that one is returned untouched */
  started: boolean;
}

/** creates an active workout prefilled from the template, unless one is already open */
export function startWorkoutFromTemplate(templateId: string, now = Date.now()): StartFromTemplateResult | undefined {
  const unit = getPreferredUnit();
  return write((tx): StartFromTemplateResult | undefined => {
    const active = tx.select().from(workouts).where(eq(workouts.status, "active")).get();
    if (active) return { workout: active, started: false };
    const template = tx.select().from(templates).where(eq(templates.id, templateId)).get();
    if (!template) return undefined;
    const workout = tx
      .insert(workouts)
      .values({
        id: randomUUID(),
        title: clampTitle(template.name),
        startedAt: now,
        utcOffsetMin: -new Date(now).getTimezoneOffset(),
        templateId,
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    writeOutbox(tx, "workout", workout.id, "insert", workout);
    const exs = tx
      .select()
      .from(templateExercises)
      .where(eq(templateExercises.templateId, templateId))
      .orderBy(asc(templateExercises.position))
      .all();
    exs.forEach((te, i) => {
      const we = tx
        .insert(workoutExercises)
        .values({
          id: randomUUID(),
          workoutId: workout.id,
          exerciseId: te.exerciseId,
          position: i,
          notes: te.notes,
          supersetGroup: te.supersetGroup,
          restS: te.restS,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get();
      writeOutbox(tx, "workout_exercise", we.id, "insert", we);
      // blank planned fields fill from last session, like adding the exercise by hand
      const previous = previousSessionSets(tx, te.exerciseId, workout.id);
      setsFromPlanned(parsePlannedSets(te.plannedSets), unit, previous).forEach((values, j) => {
        const s = tx
          .insert(sets)
          .values({
            id: randomUUID(),
            workoutExerciseId: we.id,
            position: j,
            // older plans were saved before clamping existed
            ...clampSetNumbers(values),
            completed: 0,
            note: null,
            createdAt: now,
            updatedAt: now,
          })
          .returning()
          .get();
        writeOutbox(tx, "set", s.id, "insert", s);
      });
    });
    return { workout, started: true };
  });
}
