import { and, asc, eq, gt, inArray, isNull, or } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import {
  SNAPSHOT_ENTITIES,
  SNAPSHOT_PAGE_MAX,
  SYNC_PROTOCOL_VERSION,
  type SnapshotEntity,
  type SyncSnapshotPage,
  type BodyweightPayload,
  type CustomExercisePayload,
  type Equipment,
  type SetKind,
  type SetPayload,
  type SyncSnapshot,
  type TemplateExercisePayload,
  type TemplateFolderPayload,
  type TemplatePayload,
  type TrackingType,
  type WeightUnit,
  type WorkoutExercisePayload,
  type WorkoutPayload,
  type WorkoutStatus,
} from "lift-core";
import { getDb } from "@/lib/db";
import {
  exerciseMuscles,
  exercises,
  liftBodyweights,
  liftSets,
  liftTemplateExercises,
  liftTemplateFolders,
  liftTemplates,
  liftWorkoutExercises,
  liftWorkouts,
  type ExerciseMuscleRow,
  type ExerciseRow,
  type LiftBodyweightRow,
  type LiftSetRow,
  type LiftTemplateExerciseRow,
  type LiftTemplateFolderRow,
  type LiftTemplateRow,
  type LiftWorkoutExerciseRow,
  type LiftWorkoutRow,
} from "@/lib/db/lift-schema";
import { liftTimezone, localToUtc } from "../time";
import { EQUIPMENT, SET_KINDS, TRACKING_TYPES, WORKOUT_STATUSES } from "./validate";

// server rows -> the phone's payload shapes, for a reinstall restore. workout
// shares come back as finished workouts so the phone sees one history.

const ms = (d: Date) => d.getTime();
const bit = (b: boolean): 0 | 1 => (b ? 1 : 0);

function pick<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return value != null && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

export function workoutPayload(row: LiftWorkoutRow, tz = liftTimezone()): WorkoutPayload {
  let startedAt = row.startedAt ? ms(row.startedAt) : null;
  let utcOffsetMin = row.utcOffsetMin;
  if (startedAt == null) {
    // older imported rows without a zone: read the wall clock in LIFT_TIMEZONE
    const utc = localToUtc(row.startedLocal, tz);
    startedAt = utc ? ms(utc.date) : ms(row.createdAt);
    utcOffsetMin ??= utc?.utcOffsetMin ?? null;
  }
  const endedAt = row.endedAt
    ? ms(row.endedAt)
    : row.durationS != null && row.durationS > 0
      ? startedAt + row.durationS * 1000
      : null;
  return {
    id: row.id,
    title: row.title,
    startedAt,
    endedAt,
    utcOffsetMin,
    status: row.source === "app" ? pick<WorkoutStatus>(row.status, WORKOUT_STATUSES, "finished") : "finished",
    templateId: row.templateId,
    notes: row.notes,
    createdAt: ms(row.createdAt),
    updatedAt: ms(row.updatedAt),
  };
}

export function workoutExercisePayload(row: LiftWorkoutExerciseRow): WorkoutExercisePayload {
  return {
    id: row.id,
    workoutId: row.workoutId,
    exerciseId: row.exerciseId,
    position: row.position,
    notes: row.notes,
    supersetGroup: row.supersetGroup,
    restS: row.restS,
    createdAt: ms(row.createdAt),
    updatedAt: ms(row.updatedAt),
  };
}

export function setPayload(row: LiftSetRow): SetPayload {
  return {
    id: row.id,
    workoutExerciseId: row.workoutExerciseId,
    position: row.position,
    kind: pick<SetKind>(row.kind, SET_KINDS, "normal"),
    weight: row.weight,
    unit: pick<WeightUnit>(row.unit, ["lb", "kg"], "lb"),
    reps: row.reps,
    durationS: row.durationS,
    distanceM: row.distanceM,
    rpe: row.rpe,
    completed: bit(row.completed),
    note: row.note,
    createdAt: ms(row.createdAt),
    updatedAt: ms(row.updatedAt),
  };
}

export function customExercisePayload(row: ExerciseRow, muscles: readonly ExerciseMuscleRow[]): CustomExercisePayload {
  const mine = muscles.filter((m) => m.exerciseId === row.id);
  return {
    id: row.id,
    name: row.name,
    equipment: pick<Equipment>(row.equipment, EQUIPMENT, "other"),
    tracking: pick<TrackingType>(row.tracking, TRACKING_TYPES, "weight_reps"),
    primary: JSON.stringify(mine.filter((m) => m.role === "primary").map((m) => m.region).sort()),
    secondary: JSON.stringify(mine.filter((m) => m.role !== "primary").map((m) => m.region).sort()),
    archived: bit(row.archived),
    mergedInto: row.mergedInto,
    createdAt: ms(row.createdAt),
    updatedAt: ms(row.updatedAt),
  };
}

export function templateFolderPayload(row: LiftTemplateFolderRow): TemplateFolderPayload {
  return { id: row.id, name: row.name, position: row.position, createdAt: ms(row.createdAt), updatedAt: ms(row.updatedAt) };
}

export function templatePayload(row: LiftTemplateRow): TemplatePayload {
  return {
    id: row.id,
    folderId: row.folderId,
    name: row.name,
    notes: row.notes,
    position: row.position,
    archived: bit(row.archived),
    createdAt: ms(row.createdAt),
    updatedAt: ms(row.updatedAt),
  };
}

export function templateExercisePayload(row: LiftTemplateExerciseRow): TemplateExercisePayload {
  const planned = (row.plannedSets ?? []).map((s) => ({
    kind: pick<SetKind>(s.kind ?? null, SET_KINDS, "normal"),
    weight: s.weight ?? null,
    unit: pick<WeightUnit>(s.unit ?? null, ["lb", "kg"], "lb"),
    reps: s.reps ?? null,
    durationS: s.durationS ?? null,
    distanceM: s.distanceM ?? null,
  }));
  return {
    id: row.id,
    templateId: row.templateId,
    exerciseId: row.exerciseId,
    position: row.position,
    supersetGroup: row.supersetGroup,
    restS: row.restS,
    plannedSets: JSON.stringify(planned),
    notes: row.notes,
    createdAt: ms(row.createdAt),
    updatedAt: ms(row.updatedAt),
  };
}

export function bodyweightPayload(row: LiftBodyweightRow): BodyweightPayload {
  return {
    id: row.id,
    measuredAt: ms(row.measuredAt),
    weight: row.weight,
    unit: pick<WeightUnit>(row.unit, ["lb", "kg"], "lb"),
    note: row.note,
    createdAt: ms(row.createdAt),
    updatedAt: ms(row.updatedAt),
  };
}

export interface SnapshotRows {
  customExercises: ExerciseRow[];
  muscles: ExerciseMuscleRow[];
  templateFolders: LiftTemplateFolderRow[];
  templates: LiftTemplateRow[];
  templateExercises: LiftTemplateExerciseRow[];
  workouts: LiftWorkoutRow[];
  workoutExercises: LiftWorkoutExerciseRow[];
  sets: LiftSetRow[];
  bodyweights: LiftBodyweightRow[];
}

export function buildSnapshot(rows: SnapshotRows, now = new Date(), tz?: string): SyncSnapshot {
  return {
    protocol: SYNC_PROTOCOL_VERSION,
    generatedAt: ms(now),
    customExercises: rows.customExercises.map((r) => customExercisePayload(r, rows.muscles)),
    templateFolders: rows.templateFolders.map(templateFolderPayload),
    templates: rows.templates.map(templatePayload),
    templateExercises: rows.templateExercises.map(templateExercisePayload),
    workouts: rows.workouts.map((r) => workoutPayload(r, tz)),
    workoutExercises: rows.workoutExercises.map(workoutExercisePayload),
    sets: rows.sets.map(setPayload),
    bodyweights: rows.bodyweights.map(bodyweightPayload),
  };
}

// ---------------------------------------------------------------------------
// paging: one entity per request, id order, so no response nears the host's
// response size cap however long the history gets

export interface SnapshotQuery {
  entity: SnapshotEntity;
  /** exclusive id cursor; null = from the start */
  after: string | null;
  limit: number;
}

/** ?entity=<key>&after=<id>&limit=<n>, validated */
export function parseSnapshotQuery(params: URLSearchParams): { ok: true; query: SnapshotQuery } | { ok: false; error: string } {
  const entity = params.get("entity");
  if (!entity || !(SNAPSHOT_ENTITIES as readonly string[]).includes(entity)) {
    return { ok: false, error: `entity must be one of ${SNAPSHOT_ENTITIES.join(", ")}` };
  }
  const after = params.get("after");
  if (after != null && (after.length === 0 || after.length > 128)) return { ok: false, error: "after must be 1..128 chars" };
  const rawLimit = params.get("limit");
  const limit = rawLimit == null ? SNAPSHOT_PAGE_MAX : Number(rawLimit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > SNAPSHOT_PAGE_MAX) {
    return { ok: false, error: `limit must be 1..${SNAPSHOT_PAGE_MAX}` };
  }
  return { ok: true, query: { entity: entity as SnapshotEntity, after, limit } };
}

/** `payloads` was read with limit + 1, so one extra row means there is a next page */
export function snapshotPage<K extends SnapshotEntity>(
  entity: K,
  payloads: SyncSnapshot[K],
  limit: number,
  now = new Date()
): SyncSnapshotPage<K> {
  const more = payloads.length > limit;
  const rows = (more ? payloads.slice(0, limit) : payloads) as SyncSnapshot[K];
  return {
    protocol: SYNC_PROTOCOL_VERSION,
    entity,
    rows,
    next: more && rows.length ? rows[rows.length - 1].id : null,
    generatedAt: ms(now),
  };
}

export async function loadSnapshotPage(q: SnapshotQuery, now = new Date()): Promise<SyncSnapshotPage> {
  const db = getDb();
  const w = liftWorkouts;
  const n = q.limit + 1;
  // soft-deleted workout shares stay hidden; app rows (discarded included) go back as-is
  const visible = or(eq(w.source, "app"), isNull(w.deletedAt));
  const after = (col: PgColumn) => (q.after != null ? gt(col, q.after) : undefined);
  const page = <K extends SnapshotEntity>(entity: K, payloads: SyncSnapshot[K]) => snapshotPage(entity, payloads, q.limit, now);

  switch (q.entity) {
    case "customExercises": {
      const rows = await db
        .select()
        .from(exercises)
        .where(and(eq(exercises.isCustom, true), after(exercises.id)))
        .orderBy(asc(exercises.id))
        .limit(n);
      const muscles = rows.length
        ? await db
            .select()
            .from(exerciseMuscles)
            .where(inArray(exerciseMuscles.exerciseId, rows.map((r) => r.id)))
        : [];
      return page(q.entity, rows.map((r) => customExercisePayload(r, muscles)));
    }
    case "templateFolders": {
      const t = liftTemplateFolders;
      const rows = await db.select().from(t).where(after(t.id)).orderBy(asc(t.id)).limit(n);
      return page(q.entity, rows.map(templateFolderPayload));
    }
    case "templates": {
      const t = liftTemplates;
      const rows = await db.select().from(t).where(after(t.id)).orderBy(asc(t.id)).limit(n);
      return page(q.entity, rows.map(templatePayload));
    }
    case "templateExercises": {
      const t = liftTemplateExercises;
      const rows = await db.select().from(t).where(after(t.id)).orderBy(asc(t.id)).limit(n);
      return page(q.entity, rows.map(templateExercisePayload));
    }
    case "workouts": {
      const rows = await db.select().from(w).where(and(visible, after(w.id))).orderBy(asc(w.id)).limit(n);
      return page(q.entity, rows.map((r) => workoutPayload(r)));
    }
    case "workoutExercises": {
      const we = liftWorkoutExercises;
      const rows = await db
        .select({ we })
        .from(we)
        .innerJoin(w, eq(w.id, we.workoutId))
        .where(and(visible, after(we.id)))
        .orderBy(asc(we.id))
        .limit(n);
      return page(q.entity, rows.map((r) => workoutExercisePayload(r.we)));
    }
    case "sets": {
      const rows = await db
        .select({ s: liftSets })
        .from(liftSets)
        .innerJoin(liftWorkoutExercises, eq(liftWorkoutExercises.id, liftSets.workoutExerciseId))
        .innerJoin(w, eq(w.id, liftWorkoutExercises.workoutId))
        .where(and(visible, after(liftSets.id)))
        .orderBy(asc(liftSets.id))
        .limit(n);
      return page(q.entity, rows.map((r) => setPayload(r.s)));
    }
    case "bodyweights": {
      const t = liftBodyweights;
      const rows = await db.select().from(t).where(after(t.id)).orderBy(asc(t.id)).limit(n);
      return page(q.entity, rows.map(bodyweightPayload));
    }
  }
}
