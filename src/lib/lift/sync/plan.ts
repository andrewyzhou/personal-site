import { and, eq, getTableColumns, lte, sql, type SQL } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import {
  e1rm,
  getExercise,
  isImportedWorkoutId,
  toKg,
  type BodyweightPayload,
  type CustomExercisePayload,
  type SetPayload,
  type SyncMutation,
  type SyncPayloads,
  type TemplateExercisePayload,
  type TemplateFolderPayload,
  type TemplatePayload,
  type WorkoutExercisePayload,
  type WorkoutPayload,
} from "lift-core";
import type { getDb } from "@/lib/db";
import {
  exerciseAliases,
  exerciseMuscles,
  exercises,
  liftBodyweights,
  liftSets,
  liftSyncLog,
  liftTemplateExercises,
  liftTemplateFolders,
  liftTemplates,
  liftWorkoutExercises,
  liftWorkouts,
  type NewExerciseAliasRow,
  type NewExerciseMuscleRow,
  type NewExerciseRow,
  type NewLiftBodyweightRow,
  type NewLiftSetRow,
  type NewLiftSyncLogRow,
  type NewLiftTemplateExerciseRow,
  type NewLiftTemplateFolderRow,
  type NewLiftTemplateRow,
  type NewLiftWorkoutExerciseRow,
  type NewLiftWorkoutRow,
  type PlannedSet,
} from "@/lib/db/lift-schema";
import { catalogExerciseRows } from "../rows";
import { liftTimezone, utcToLocal } from "../time";
import type { MutationResult } from "./validate";

// pure push planning: validated mutations + what the db already has in, the
// ordered statements for one atomic db.batch out. query builders are built
// here but never executed.

type Db = ReturnType<typeof getDb>;

/** what the up-front select found for ids the request references */
export interface SyncState {
  /** seqs already applied for this device. seqs logged as rejected are left out, so a replay re-evaluates them */
  seenSeqs: ReadonlySet<number>;
  workouts: ReadonlySet<string>;
  workoutExercises: ReadonlyMap<string, { workoutId: string; exerciseId: string; tracking: string | null }>;
  /** set id -> its workout, for set deletes */
  sets: ReadonlyMap<string, string>;
  templates: ReadonlySet<string>;
  folders: ReadonlySet<string>;
  /** non-catalog exercise rows */
  exercises: ReadonlyMap<string, { name: string; tracking: string }>;
}

/** ids the planner needs looked up before it can decide anything */
export interface SyncRefs {
  seqs: number[];
  workoutIds: string[];
  workoutExerciseIds: string[];
  setIds: string[];
  templateIds: string[];
  folderIds: string[];
  exerciseIds: string[];
}

export interface PreparedMutation {
  seq: number;
  raw: Record<string, unknown>;
  result: MutationResult;
}

export interface SyncPlan {
  statements: BatchItem<"pg">[];
  applied: number;
  skipped: number;
  rejected: { seq: number; reason: string }[];
  appliedThrough: number;
  /** workouts whose sets/exercises changed: aggregates get recomputed */
  touchedWorkoutIds: string[];
  /** merge targets: every workout now using them gets recomputed */
  mergeTargetIds: string[];
}

// tracking types where the logged weight is relative to bodyweight
const BODYWEIGHT_TRACKING = new Set(["weighted_bodyweight", "assisted_bodyweight", "reps"]);

function round(n: number, places = 3): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

const date = (ms: number) => new Date(ms);
const flag = (v: 0 | 1) => v === 1;

export function collectRefs(prepared: readonly PreparedMutation[]): SyncRefs {
  const refs = {
    workoutIds: new Set<string>(),
    workoutExerciseIds: new Set<string>(),
    setIds: new Set<string>(),
    templateIds: new Set<string>(),
    folderIds: new Set<string>(),
    exerciseIds: new Set<string>(),
  };
  const exercise = (exId: string | null) => {
    if (exId && !getExercise(exId)) refs.exerciseIds.add(exId);
  };
  for (const p of prepared) {
    if (!p.result.ok) continue;
    const m = p.result.mutation;
    if (m.op === "delete") {
      if (m.entity === "set") refs.setIds.add(m.id);
      if (m.entity === "workout_exercise") refs.workoutExerciseIds.add(m.id);
      continue;
    }
    switch (m.entity) {
      case "workout_exercise": {
        const pl = m.payload as WorkoutExercisePayload;
        refs.workoutIds.add(pl.workoutId);
        refs.workoutExerciseIds.add(pl.id);
        exercise(pl.exerciseId);
        break;
      }
      case "set":
        refs.workoutExerciseIds.add((m.payload as SetPayload).workoutExerciseId);
        break;
      case "template":
        if ((m.payload as TemplatePayload).folderId) refs.folderIds.add((m.payload as TemplatePayload).folderId!);
        break;
      case "template_exercise": {
        const pl = m.payload as TemplateExercisePayload;
        refs.templateIds.add(pl.templateId);
        exercise(pl.exerciseId);
        break;
      }
      case "custom_exercise":
        exercise((m.payload as CustomExercisePayload).mergedInto);
        break;
    }
  }
  return {
    seqs: prepared.map((p) => p.seq),
    workoutIds: [...refs.workoutIds],
    workoutExerciseIds: [...refs.workoutExerciseIds],
    setIds: [...refs.setIds],
    templateIds: [...refs.templateIds],
    folderIds: [...refs.folderIds],
    exerciseIds: [...refs.exerciseIds],
  };
}

// ---------------------------------------------------------------------------
// payload -> row mapping

/** wall clock from the device's own offset when it sent one, else LIFT_TIMEZONE */
export function startedLocalFor(startedAtMs: number, utcOffsetMin: number | null, tz = liftTimezone()): string {
  if (utcOffsetMin != null) return new Date(startedAtMs + utcOffsetMin * 60_000).toISOString().slice(0, 16);
  return utcToLocal(new Date(startedAtMs), tz);
}

export function workoutRow(p: WorkoutPayload, tz?: string): NewLiftWorkoutRow & { id: string } {
  return {
    id: p.id,
    title: p.title.trim() || "workout",
    startedLocal: startedLocalFor(p.startedAt, p.utcOffsetMin, tz),
    startedAt: date(p.startedAt),
    utcOffsetMin: p.utcOffsetMin,
    endedAt: p.endedAt != null ? date(p.endedAt) : null,
    durationS: p.endedAt != null && p.endedAt >= p.startedAt ? Math.round((p.endedAt - p.startedAt) / 1000) : null,
    notes: p.notes,
    source: "app",
    status: p.status,
    templateId: p.templateId,
    // discarded workouts hide like a soft-deleted strong share; un-discarding clears it.
    // imported workouts follow the same rule: the phone's status drives deletedAt
    // (discarded -> set, finished -> cleared), while source stays server-owned
    deletedAt: p.status === "discarded" ? date(p.updatedAt) : null,
    createdAt: date(p.createdAt),
    updatedAt: date(p.updatedAt),
  };
}

export function workoutExerciseRow(p: WorkoutExercisePayload, nameRaw: string): NewLiftWorkoutExerciseRow {
  return {
    id: p.id,
    workoutId: p.workoutId,
    exerciseId: p.exerciseId,
    position: p.position,
    nameRaw,
    notes: p.notes,
    supersetGroup: p.supersetGroup,
    restS: p.restS,
    createdAt: date(p.createdAt),
    updatedAt: date(p.updatedAt),
  };
}

export function setRow(p: SetPayload, bodyweight: boolean): NewLiftSetRow {
  const weightKg = p.weight != null ? round(toKg(p.weight, p.unit)) : null;
  const completed = flag(p.completed);
  // same rule as the share-text planner: absolute loads on completed working sets only
  const est =
    completed && p.kind !== "warmup" && !bodyweight && weightKg != null && weightKg > 0 && p.reps != null && p.reps > 0
      ? e1rm(weightKg, p.reps)
      : null;
  return {
    id: p.id,
    workoutExerciseId: p.workoutExerciseId,
    position: p.position,
    kind: p.kind,
    weight: p.weight,
    unit: p.unit,
    weightKg,
    reps: p.reps,
    durationS: p.durationS,
    distanceM: p.distanceM,
    rpe: p.rpe,
    bodyweight,
    note: p.note,
    e1rmKg: est != null ? round(est, 2) : null,
    completed,
    createdAt: date(p.createdAt),
    updatedAt: date(p.updatedAt),
  };
}

export function customExerciseRow(p: CustomExercisePayload): NewExerciseRow {
  return {
    id: p.id,
    name: p.name.trim(),
    equipment: p.equipment,
    category: p.tracking === "distance_duration" ? "cardio" : "strength",
    tracking: p.tracking,
    source: "app",
    isCustom: true,
    archived: flag(p.archived),
    mergedInto: p.mergedInto,
    createdAt: date(p.createdAt),
    updatedAt: date(p.updatedAt),
  };
}

export function customMuscleRows(p: CustomExercisePayload): NewExerciseMuscleRow[] {
  const out = new Map<string, NewExerciseMuscleRow>();
  for (const region of JSON.parse(p.primary) as string[]) out.set(region, { exerciseId: p.id, region, role: "primary" });
  // listed both ways counts as primary (pk is exercise+region)
  for (const region of JSON.parse(p.secondary) as string[]) {
    if (!out.has(region)) out.set(region, { exerciseId: p.id, region, role: "secondary" });
  }
  return [...out.values()];
}

export function templateFolderRow(p: TemplateFolderPayload): NewLiftTemplateFolderRow {
  return { id: p.id, name: p.name, position: p.position, createdAt: date(p.createdAt), updatedAt: date(p.updatedAt) };
}

export function templateRow(p: TemplatePayload): NewLiftTemplateRow {
  return {
    id: p.id,
    name: p.name,
    folderId: p.folderId,
    notes: p.notes,
    position: p.position,
    archived: flag(p.archived),
    createdAt: date(p.createdAt),
    updatedAt: date(p.updatedAt),
  };
}

export function templateExerciseRow(p: TemplateExercisePayload): NewLiftTemplateExerciseRow {
  return {
    id: p.id,
    templateId: p.templateId,
    exerciseId: p.exerciseId,
    position: p.position,
    supersetGroup: p.supersetGroup,
    restS: p.restS,
    plannedSets: JSON.parse(p.plannedSets) as PlannedSet[],
    notes: p.notes,
    createdAt: date(p.createdAt),
    updatedAt: date(p.updatedAt),
  };
}

export function bodyweightRow(p: BodyweightPayload): NewLiftBodyweightRow {
  return {
    id: p.id,
    measuredAt: date(p.measuredAt),
    weight: p.weight,
    unit: p.unit,
    note: p.note,
    createdAt: date(p.createdAt),
    updatedAt: date(p.updatedAt),
  };
}

// ---------------------------------------------------------------------------
// statements

/** `col = excluded.col` for every column except `skip` */
function excludedExcept(table: PgTable, skip: readonly string[]): Record<string, SQL> {
  const out: Record<string, SQL> = {};
  for (const [key, col] of Object.entries(getTableColumns(table))) {
    if (!skip.includes(key)) out[key] = sql.raw(`excluded."${(col as PgColumn).name}"`);
  }
  return out;
}

// last write wins: an older push never overwrites a newer row
function newerOrSame(updatedAt: PgColumn): SQL {
  return sql`${updatedAt} <= excluded."updated_at"`;
}

const iso = (ms: number) => new Date(ms).toISOString();

interface LiveState {
  workouts: Set<string>;
  workoutExercises: Map<string, { workoutId: string; exerciseId: string; tracking: string | null }>;
  sets: Map<string, string>;
  templates: Set<string>;
  folders: Set<string>;
  exercises: Map<string, { name: string; tracking: string }>;
}

type Outcome = { statements: BatchItem<"pg">[] } | { reject: string };

export function planSync(
  db: Db,
  deviceId: string,
  prepared: readonly PreparedMutation[],
  state: SyncState,
  opts: { timezone?: string } = {}
): SyncPlan {
  const live: LiveState = {
    workouts: new Set(state.workouts),
    workoutExercises: new Map(state.workoutExercises),
    sets: new Map(state.sets),
    templates: new Set(state.templates),
    folders: new Set(state.folders),
    exercises: new Map(state.exercises),
  };
  const touched = new Set<string>();
  const mergeTargets = new Set<string>();
  const catalogIds = new Set<string>();
  const body: BatchItem<"pg">[] = [];
  const logRows: NewLiftSyncLogRow[] = [];
  const rejected: { seq: number; reason: string }[] = [];
  let applied = 0;
  let skipped = 0;
  let appliedThrough = 0;

  // catalog slug -> its name; custom id -> its name; else null (unknown)
  const exerciseName = (exId: string): string | null => {
    const cat = getExercise(exId);
    if (cat) {
      catalogIds.add(cat.id);
      return cat.name;
    }
    return live.exercises.get(exId)?.name ?? null;
  };
  const exerciseTracking = (exId: string): string | null =>
    getExercise(exId)?.tracking ?? live.exercises.get(exId)?.tracking ?? null;

  const t = {
    w: liftWorkouts,
    we: liftWorkoutExercises,
    s: liftSets,
    ex: exercises,
    f: liftTemplateFolders,
    tp: liftTemplates,
    te: liftTemplateExercises,
    bw: liftBodyweights,
  };

  function upsertWorkout(p: WorkoutPayload): Outcome {
    live.workouts.add(p.id);
    touched.add(p.id);
    return {
      statements: [
        db
          .insert(t.w)
          .values(workoutRow(p, opts.timezone))
          .onConflictDoUpdate({
            target: t.w.id,
            // provenance and aggregates stay server-owned
            set: excludedExcept(t.w, [
              "id",
              "createdAt",
              "source",
              "latestIngestId",
              "strongSlug",
              "workingSets",
              "volumeKg",
              "muscleLoad",
            ]),
            setWhere: newerOrSame(t.w.updatedAt),
          }),
      ],
    };
  }

  function upsertWorkoutExercise(p: WorkoutExercisePayload): Outcome {
    if (!live.workouts.has(p.workoutId)) return { reject: `workout ${p.workoutId} not found` };
    const before = live.workoutExercises.get(p.id);
    // a re-share replaces an imported workout's contents, so phone additions would vanish
    if (!before && isImportedWorkoutId(p.workoutId)) {
      return { reject: `workout ${p.workoutId} is an imported workout: exercises can't be added to it` };
    }
    const name = exerciseName(p.exerciseId);
    if (name == null) return { reject: `exercise ${p.exerciseId} not found` };
    if (before) touched.add(before.workoutId);
    touched.add(p.workoutId);
    live.workoutExercises.set(p.id, {
      workoutId: p.workoutId,
      exerciseId: p.exerciseId,
      tracking: exerciseTracking(p.exerciseId),
    });
    return {
      statements: [
        db
          .insert(t.we)
          .values(workoutExerciseRow(p, name))
          .onConflictDoUpdate({
            target: t.we.id,
            set: {
              ...excludedExcept(t.we, ["id", "createdAt", "nameRaw"]),
              // keep strong's printed name while the exercise is unchanged
              nameRaw: sql.raw(
                `case when "lift_workout_exercises"."exercise_id" = excluded."exercise_id" ` +
                  `then "lift_workout_exercises"."name_raw" else excluded."name_raw" end`
              ),
            },
            setWhere: newerOrSame(t.we.updatedAt),
          }),
      ],
    };
  }

  function upsertSet(p: SetPayload): Outcome {
    const parent = live.workoutExercises.get(p.workoutExerciseId);
    if (!parent) return { reject: `workout exercise ${p.workoutExerciseId} not found` };
    const before = live.sets.get(p.id);
    if (!before && isImportedWorkoutId(parent.workoutId)) {
      return { reject: `workout ${parent.workoutId} is an imported workout: sets can't be added to it` };
    }
    touched.add(parent.workoutId);
    if (before) touched.add(before);
    live.sets.set(p.id, parent.workoutId);
    const bodyweight = parent.tracking != null && BODYWEIGHT_TRACKING.has(parent.tracking);
    return {
      statements: [
        db
          .insert(t.s)
          .values(setRow(p, bodyweight))
          .onConflictDoUpdate({
            target: t.s.id,
            set: excludedExcept(t.s, ["id", "createdAt"]),
            setWhere: newerOrSame(t.s.updatedAt),
          }),
      ],
    };
  }

  function upsertCustomExercise(p: CustomExercisePayload): Outcome {
    if (getExercise(p.id)) return { reject: `${p.id} is a catalog exercise` };
    if (p.mergedInto && exerciseName(p.mergedInto) == null) {
      return { reject: `merge target ${p.mergedInto} not found` };
    }
    live.exercises.set(p.id, { name: p.name.trim(), tracking: p.tracking });
    const landed = sql`exists (select 1 from "exercises" e where e."id" = ${p.id} and e."updated_at" = ${iso(p.updatedAt)}::timestamptz)`;
    const statements: BatchItem<"pg">[] = [
      db
        .insert(t.ex)
        .values(customExerciseRow(p))
        .onConflictDoUpdate({
          target: t.ex.id,
          set: excludedExcept(t.ex, ["id", "createdAt", "source", "freeDbId"]),
          // never let a push rewrite a catalog row
          setWhere: and(newerOrSame(t.ex.updatedAt), sql`${t.ex.source} <> 'catalog'`),
        }),
      // muscles follow the row only when this push actually won
      db.delete(exerciseMuscles).where(and(eq(exerciseMuscles.exerciseId, p.id), landed)),
    ];
    const muscles = customMuscleRows(p);
    if (muscles.length) {
      const values = sql.join(
        muscles.map((m) => sql`(${m.exerciseId}, ${m.region}, ${m.role})`),
        sql`, `
      );
      statements.push(
        db
          .insert(exerciseMuscles)
          .select(sql`select v.exercise_id, v.region, v.role from (values ${values}) as v(exercise_id, region, role) where ${landed}`)
          .onConflictDoNothing()
      );
    }
    if (p.mergedInto) {
      mergeTargets.add(p.mergedInto);
      // history logged against the old id (strong shares included) follows the merge
      const merged = sql`exists (select 1 from "exercises" e where e."id" = ${p.id} and e."merged_into" = ${p.mergedInto})`;
      statements.push(
        db
          .update(t.we)
          .set({ exerciseId: p.mergedInto })
          .where(and(eq(t.we.exerciseId, p.id), merged)),
        db
          .update(t.te)
          .set({ exerciseId: p.mergedInto })
          .where(and(eq(t.te.exerciseId, p.id), merged))
      );
      for (const [weId, we] of live.workoutExercises) {
        // later sets in this batch must see the target's tracking (bodyweight flag)
        if (we.exerciseId === p.id) {
          live.workoutExercises.set(weId, { ...we, exerciseId: p.mergedInto, tracking: exerciseTracking(p.mergedInto) });
        }
      }
    }
    return { statements };
  }

  function deleteCustomExercise(id: string, at: number): Outcome {
    if (getExercise(id)) return { reject: `${id} is a catalog exercise` };
    live.exercises.delete(id);
    const unreferenced = sql`not exists (select 1 from "lift_workout_exercises" x where x."exercise_id" = ${id}) and not exists (select 1 from "lift_template_exercises" x where x."exercise_id" = ${id})`;
    return {
      statements: [
        // history still points at it: archive instead of breaking the fk
        // stamped with the phone's clock so lww keeps comparing phone times
        db
          .update(t.ex)
          .set({ archived: true, updatedAt: date(at) })
          .where(and(eq(t.ex.id, id), eq(t.ex.isCustom, true), lte(t.ex.updatedAt, date(at)))),
        db.delete(t.ex).where(and(eq(t.ex.id, id), eq(t.ex.isCustom, true), unreferenced)),
      ],
    };
  }

  function upsertTemplate(p: TemplatePayload): Outcome {
    if (p.folderId && !live.folders.has(p.folderId)) return { reject: `folder ${p.folderId} not found` };
    live.templates.add(p.id);
    return {
      statements: [
        db
          .insert(t.tp)
          .values(templateRow(p))
          .onConflictDoUpdate({
            target: t.tp.id,
            set: excludedExcept(t.tp, ["id", "createdAt", "folder"]),
            setWhere: newerOrSame(t.tp.updatedAt),
          }),
      ],
    };
  }

  function upsertTemplateExercise(p: TemplateExercisePayload): Outcome {
    if (!live.templates.has(p.templateId)) return { reject: `template ${p.templateId} not found` };
    if (exerciseName(p.exerciseId) == null) return { reject: `exercise ${p.exerciseId} not found` };
    return {
      statements: [
        db
          .insert(t.te)
          .values(templateExerciseRow(p))
          .onConflictDoUpdate({
            target: t.te.id,
            set: excludedExcept(t.te, ["id", "createdAt"]),
            setWhere: newerOrSame(t.te.updatedAt),
          }),
      ],
    };
  }

  function apply(m: SyncMutation): Outcome {
    if (m.op === "delete") {
      switch (m.entity) {
        case "workout":
          live.workouts.delete(m.id);
          // children cascade in the db, so forget them here too
          for (const [weId, we] of live.workoutExercises) if (we.workoutId === m.id) live.workoutExercises.delete(weId);
          for (const [setId, wid] of live.sets) if (wid === m.id) live.sets.delete(setId);
          touched.delete(m.id);
          return { statements: [db.delete(t.w).where(eq(t.w.id, m.id))] };
        case "workout_exercise": {
          const we = live.workoutExercises.get(m.id);
          if (we) touched.add(we.workoutId);
          live.workoutExercises.delete(m.id);
          return { statements: [db.delete(t.we).where(eq(t.we.id, m.id))] };
        }
        case "set": {
          const wid = live.sets.get(m.id);
          if (wid) touched.add(wid);
          live.sets.delete(m.id);
          return { statements: [db.delete(t.s).where(eq(t.s.id, m.id))] };
        }
        case "custom_exercise":
          return deleteCustomExercise(m.id, m.at);
        case "template_folder":
          // templates keep existing; the fk sets their folder_id null
          live.folders.delete(m.id);
          return { statements: [db.delete(t.f).where(eq(t.f.id, m.id))] };
        case "template":
          live.templates.delete(m.id);
          return { statements: [db.delete(t.tp).where(eq(t.tp.id, m.id))] };
        case "template_exercise":
          return { statements: [db.delete(t.te).where(eq(t.te.id, m.id))] };
        case "bodyweight":
          return { statements: [db.delete(t.bw).where(eq(t.bw.id, m.id))] };
      }
    }
    const p = m.payload as SyncPayloads[typeof m.entity];
    switch (m.entity) {
      case "workout":
        return upsertWorkout(p as WorkoutPayload);
      case "workout_exercise":
        return upsertWorkoutExercise(p as WorkoutExercisePayload);
      case "set":
        return upsertSet(p as SetPayload);
      case "custom_exercise":
        return upsertCustomExercise(p as CustomExercisePayload);
      case "template_folder":
        live.folders.add(m.id);
        return {
          statements: [
            db
              .insert(t.f)
              .values(templateFolderRow(p as TemplateFolderPayload))
              .onConflictDoUpdate({
                target: t.f.id,
                set: excludedExcept(t.f, ["id", "createdAt"]),
                setWhere: newerOrSame(t.f.updatedAt),
              }),
          ],
        };
      case "template":
        return upsertTemplate(p as TemplatePayload);
      case "template_exercise":
        return upsertTemplateExercise(p as TemplateExercisePayload);
      case "bodyweight":
        return {
          statements: [
            db
              .insert(t.bw)
              .values(bodyweightRow(p as BodyweightPayload))
              .onConflictDoUpdate({
                target: t.bw.id,
                set: excludedExcept(t.bw, ["id", "createdAt"]),
                setWhere: newerOrSame(t.bw.updatedAt),
              }),
          ],
        };
    }
  }

  // workouts a mutation affects, without planning any write: replays still
  // get their aggregates recomputed, so a retry heals a recompute that failed
  const touchedBy = (m: SyncMutation): string | null => {
    if (m.entity === "workout") return m.op === "delete" ? null : m.id;
    if (m.entity === "workout_exercise") {
      return m.op === "delete"
        ? (live.workoutExercises.get(m.id)?.workoutId ?? null)
        : (m.payload as WorkoutExercisePayload).workoutId;
    }
    if (m.entity === "set") {
      if (m.op === "delete") return live.sets.get(m.id) ?? null;
      return live.workoutExercises.get((m.payload as SetPayload).workoutExerciseId)?.workoutId ?? null;
    }
    return null;
  };

  for (const prep of prepared) {
    appliedThrough = Math.max(appliedThrough, prep.seq);
    if (state.seenSeqs.has(prep.seq)) {
      skipped++;
      const wid = prep.result.ok ? touchedBy(prep.result.mutation) : null;
      if (wid && live.workouts.has(wid)) touched.add(wid);
      continue;
    }
    const entity = typeof prep.raw.entity === "string" ? prep.raw.entity.slice(0, 64) : "?";
    const entityId = typeof prep.raw.id === "string" ? prep.raw.id.slice(0, 128) : "";
    const op = typeof prep.raw.op === "string" ? prep.raw.op.slice(0, 16) : "?";
    let reason: string | null = null;
    if (!prep.result.ok) {
      reason = prep.result.reason;
    } else {
      const out = apply(prep.result.mutation);
      if ("reject" in out) reason = out.reject;
      else body.push(...out.statements);
    }
    if (reason) rejected.push({ seq: prep.seq, reason });
    else applied++;
    logRows.push({ deviceId, seq: prep.seq, entity, entityId, op, rejected: reason });
  }

  const statements: BatchItem<"pg">[] = [];
  // catalog rows any mutation references ride along, as with share ingests
  if (catalogIds.size) {
    const rows = [...catalogIds].map((cid) => catalogExerciseRows(getExercise(cid)!));
    const aliases: NewExerciseAliasRow[] = rows.flatMap((r) => r.aliases);
    const muscles: NewExerciseMuscleRow[] = rows.flatMap((r) => r.muscles);
    statements.push(db.insert(exercises).values(rows.map((r) => r.exercise)).onConflictDoNothing());
    if (aliases.length) statements.push(db.insert(exerciseAliases).values(aliases).onConflictDoNothing());
    if (muscles.length) statements.push(db.insert(exerciseMuscles).values(muscles).onConflictDoNothing());
  }
  statements.push(...body);
  if (logRows.length) {
    statements.push(
      db
        .insert(liftSyncLog)
        .values(logRows)
        .onConflictDoUpdate({
          target: [liftSyncLog.deviceId, liftSyncLog.seq],
          // a re-evaluated rejection records its new outcome; applied rows stay as they were
          set: {
            entity: sql.raw(`excluded."entity"`),
            entityId: sql.raw(`excluded."entity_id"`),
            op: sql.raw(`excluded."op"`),
            rejected: sql.raw(`excluded."rejected"`),
            appliedAt: sql`now()`,
          },
          setWhere: sql`${liftSyncLog.rejected} is not null`,
        })
    );
  }

  return {
    statements,
    applied,
    skipped,
    rejected,
    appliedThrough,
    touchedWorkoutIds: [...touched],
    mergeTargetIds: [...mergeTargets],
  };
}
