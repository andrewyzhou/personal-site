import { count, eq, ne } from "drizzle-orm";
import { EXERCISES, customExerciseId, getExercise, type Equipment, type Exercise, type MuscleRegion, type TrackingType } from "lift-core";
import { db, type Tx } from "./client";
import { notify } from "./events";
import { writeOutbox } from "./outbox";
import { clearPriorBests } from "./prs";
import { customExercises, sets, templateExercises, workoutExercises, workouts, type CustomExerciseRow } from "./schema";
import { bumpedAt } from "../lib/clock";
import { customToExercise, isCustomInUse, type CustomUsage } from "../lib/custom";
import { buildExerciseLookup, catalogCollision, isSearchable, searchCatalog, type ExerciseLookup } from "../lib/library";
import { mergeLinkMap, planMerge, type MergeCheck } from "../lib/merge";
import { cleanName, nameKeyLoose, validateName } from "../lib/names";
import { toUsageMap } from "../lib/usage";

function write<T>(fn: (tx: Tx) => T): T {
  const result = db.transaction(fn);
  notify();
  return result;
}

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

/** every custom row, archived and merged included */
export function listCustomRows(): CustomExerciseRow[] {
  return db.select().from(customExercises).all();
}

export function getCustomRow(id: string): CustomExerciseRow | undefined {
  return db.select().from(customExercises).where(eq(customExercises.id, id)).get();
}

/** searchable customs only (not archived, not merged) */
export function listCustomExercises(): Exercise[] {
  return listCustomRows().filter(isSearchable).map(customToExercise);
}

/**
 * built-in catalog plus the user's custom exercises: what search runs over.
 * archived customs only with includeArchived; merged ones never. for showing
 * an id that may be archived or merged, use getExerciseLookup / lookupExercise.
 */
export function getCatalog(options: { includeArchived?: boolean } = {}): readonly Exercise[] {
  const rows = listCustomRows();
  if (!rows.length) return EXERCISES;
  return searchCatalog(EXERCISES, rows, options.includeArchived ?? false);
}

/** id -> exercise for display: archived customs resolve, merged ids follow to their target */
export function getExerciseLookup(): ExerciseLookup {
  const rows = listCustomRows();
  if (!rows.length) return (id) => getExercise(id);
  return buildExerciseLookup(EXERCISES, rows);
}

export function lookupExercise(id: string): Exercise | undefined {
  return getExerciseLookup()(id);
}

// ---------------------------------------------------------------------------
// create / edit

export interface NewCustomExercise {
  name: string;
  equipment?: Equipment;
  tracking?: TrackingType;
  primary?: MuscleRegion[];
  secondary?: MuscleRegion[];
}

export interface NameCheckResult {
  /** cleaned name, or null with `error` set */
  name: string | null;
  error?: string;
  /** the id a create would use; null when it can't be computed */
  id: string | null;
  /** a custom row already holding that id (maybe archived or merged) */
  existing?: CustomExerciseRow;
  /** built-in exercise the name resolves to; offer it instead */
  catalog?: Exercise;
  /** a different custom (e.g. renamed) already showing this name */
  sameName?: CustomExerciseRow;
}

/** everything the create screen needs to warn about before inserting */
export function checkNewCustomName(raw: string): NameCheckResult {
  const v = validateName(raw);
  if (!v.ok) return { name: null, error: v.error, id: null };
  let id: string;
  try {
    id = customExerciseId(v.name);
  } catch (e) {
    return { name: v.name, id: null, error: e instanceof Error ? e.message : String(e) };
  }
  const existing = getCustomRow(id);
  const catalog = catalogCollision(v.name);
  const named = existing ? undefined : findCustomByName(v.name);
  return {
    name: v.name,
    id,
    ...(existing ? { existing } : {}),
    ...(catalog ? { catalog } : {}),
    ...(named ? { sameName: named } : {}),
  };
}

export type CreateCustomResult =
  | { status: "created"; exercise: Exercise; row: CustomExerciseRow }
  | { status: "exists"; row: CustomExerciseRow };

/**
 * inserts with the shared name-derived id, so the site and phone agree on it.
 * an existing row with that id is returned instead of duplicated.
 */
export function createCustomExercise(input: NewCustomExercise, now = Date.now()): CreateCustomResult {
  const v = validateName(input.name);
  if (!v.ok) throw new Error(v.error);
  const id = customExerciseId(v.name);
  const result = db.transaction((tx): CreateCustomResult => {
    const existing = tx.select().from(customExercises).where(eq(customExercises.id, id)).get();
    if (existing) return { status: "exists", row: existing };
    const row = tx
      .insert(customExercises)
      .values({
        id,
        name: v.name,
        equipment: input.equipment ?? "other",
        tracking: input.tracking ?? "weight_reps",
        primary: JSON.stringify(input.primary ?? []),
        secondary: JSON.stringify(input.secondary ?? []),
        archived: 0,
        mergedInto: null,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    writeOutbox(tx, "custom_exercise", row.id, "insert", row);
    return { status: "created", exercise: customToExercise(row), row };
  });
  if (result.status === "created") notify();
  return result;
}

export interface CustomExercisePatch {
  name?: string;
  equipment?: Equipment;
  tracking?: TrackingType;
  primary?: MuscleRegion[];
  secondary?: MuscleRegion[];
  archived?: boolean;
}

/** names other searchable customs already use, for duplicate checks on rename */
export function takenCustomNames(exceptId?: string): string[] {
  return listCustomRows()
    .filter((r) => r.id !== exceptId && !r.mergedInto)
    .map((r) => r.name);
}

/** rename keeps the id: it was fixed from the original name at creation */
export function updateCustomExercise(id: string, patch: CustomExercisePatch, now = Date.now()): CustomExerciseRow | undefined {
  const values: Partial<typeof customExercises.$inferInsert> = {};
  if (patch.name !== undefined) {
    const v = validateName(patch.name, { taken: takenCustomNames(id) });
    if (!v.ok) throw new Error(v.error);
    values.name = v.name;
  }
  if (patch.equipment !== undefined) values.equipment = patch.equipment;
  if (patch.tracking !== undefined) values.tracking = patch.tracking;
  if (patch.primary !== undefined) values.primary = JSON.stringify(patch.primary);
  if (patch.secondary !== undefined) values.secondary = JSON.stringify(patch.secondary);
  if (patch.archived !== undefined) values.archived = patch.archived ? 1 : 0;
  return write((tx) => {
    const row = tx.update(customExercises).set({ ...values, updatedAt: bumpedAt(customExercises.updatedAt, now) }).where(eq(customExercises.id, id)).returning().get();
    if (row) writeOutbox(tx, "custom_exercise", row.id, "update", row);
    return row;
  });
}

export function setCustomArchived(id: string, archived: boolean, now = Date.now()): CustomExerciseRow | undefined {
  return updateCustomExercise(id, { archived }, now);
}

export type { CustomUsage };

export function getCustomUsage(id: string): CustomUsage {
  const w = db.select({ n: count() }).from(workoutExercises).where(eq(workoutExercises.exerciseId, id)).get();
  const t = db.select({ n: count() }).from(templateExercises).where(eq(templateExercises.exerciseId, id)).get();
  const m = db.select({ n: count() }).from(customExercises).where(eq(customExercises.mergedInto, id)).get();
  return { workoutExercises: Number(w?.n ?? 0), templateExercises: Number(t?.n ?? 0), mergedFrom: Number(m?.n ?? 0) };
}

/** hard delete only when nothing points at it (merged customs included); otherwise the caller should offer archive */
export function deleteCustomExercise(id: string): "deleted" | "in_use" | "missing" {
  if (isCustomInUse(getCustomUsage(id))) return "in_use";
  return write((tx) => {
    const gone = tx.delete(customExercises).where(eq(customExercises.id, id)).returning({ id: customExercises.id }).get();
    if (!gone) return "missing";
    writeOutbox(tx, "custom_exercise", id, "delete", { id });
    return "deleted";
  });
}

/**
 * merge a custom exercise into another (catalog or custom): local workout and
 * template entries are re-pointed, then the source is archived with mergedInto
 * set so synced copies elsewhere still resolve.
 */
export function mergeCustomExercise(sourceId: string, targetId: string, now = Date.now()): MergeCheck {
  const rows = listCustomRows();
  if (!rows.some((r) => r.id === sourceId)) return { ok: false, error: "exercise not found" };
  if (!getExercise(targetId) && !rows.some((r) => r.id === targetId)) return { ok: false, error: "target not found" };
  return write((tx): MergeCheck => {
    const we = tx
      .select({ id: workoutExercises.id, exerciseId: workoutExercises.exerciseId })
      .from(workoutExercises)
      .where(eq(workoutExercises.exerciseId, sourceId))
      .all();
    const te = tx
      .select({ id: templateExercises.id, exerciseId: templateExercises.exerciseId })
      .from(templateExercises)
      .where(eq(templateExercises.exerciseId, sourceId))
      .all();
    const check = planMerge(sourceId, targetId, mergeLinkMap(rows), we, te);
    if (!check.ok) return check;
    const { plan } = check;
    for (const id of plan.workoutExercises) {
      const row = tx
        .update(workoutExercises)
        .set({ exerciseId: plan.targetId, updatedAt: bumpedAt(workoutExercises.updatedAt, now) })
        .where(eq(workoutExercises.id, id))
        .returning()
        .get();
      if (row) writeOutbox(tx, "workout_exercise", row.id, "update", row);
    }
    for (const id of plan.templateExercises) {
      const row = tx
        .update(templateExercises)
        .set({ exerciseId: plan.targetId, updatedAt: bumpedAt(templateExercises.updatedAt, now) })
        .where(eq(templateExercises.id, id))
        .returning()
        .get();
      if (row) writeOutbox(tx, "template_exercise", row.id, "update", row);
    }
    const src = tx
      .update(customExercises)
      .set({ mergedInto: plan.targetId, archived: 1, updatedAt: bumpedAt(customExercises.updatedAt, now) })
      .where(eq(customExercises.id, sourceId))
      .returning()
      .get();
    if (src) writeOutbox(tx, "custom_exercise", src.id, "update", src);
    // the target's history just grew; drop cached bests before write() notifies
    clearPriorBests();
    return check;
  });
}

/** exact (case/space-insensitive) name match among searchable customs */
export function findCustomByName(name: string): CustomExerciseRow | undefined {
  const key = nameKeyLoose(cleanName(name));
  return listCustomRows().find((r) => !r.mergedInto && nameKeyLoose(r.name) === key);
}
