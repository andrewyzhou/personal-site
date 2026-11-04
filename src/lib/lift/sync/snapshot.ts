import { asc, eq, inArray, isNull, or } from "drizzle-orm";
import {
  SYNC_PROTOCOL_VERSION,
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

export async function loadSnapshot(): Promise<SyncSnapshot> {
  const db = getDb();
  const w = liftWorkouts;
  // soft-deleted workout shares stay hidden; app rows (discarded included) go back as-is
  const visible = or(eq(w.source, "app"), isNull(w.deletedAt));
  const customIds = db.select({ id: exercises.id }).from(exercises).where(eq(exercises.isCustom, true));
  const [customExercises, muscles, templateFolders, templates, templateExercises, workouts, wes, sets, bodyweights] =
    await db.batch([
      db.select().from(exercises).where(eq(exercises.isCustom, true)).orderBy(asc(exercises.id)),
      db.select().from(exerciseMuscles).where(inArray(exerciseMuscles.exerciseId, customIds)),
      db.select().from(liftTemplateFolders).orderBy(asc(liftTemplateFolders.position), asc(liftTemplateFolders.id)),
      db.select().from(liftTemplates).orderBy(asc(liftTemplates.position), asc(liftTemplates.id)),
      db
        .select()
        .from(liftTemplateExercises)
        .orderBy(asc(liftTemplateExercises.templateId), asc(liftTemplateExercises.position)),
      db.select().from(w).where(visible).orderBy(asc(w.startedLocal), asc(w.id)),
      db
        .select({ we: liftWorkoutExercises })
        .from(liftWorkoutExercises)
        .innerJoin(w, eq(w.id, liftWorkoutExercises.workoutId))
        .where(visible)
        .orderBy(asc(liftWorkoutExercises.workoutId), asc(liftWorkoutExercises.position)),
      db
        .select({ s: liftSets })
        .from(liftSets)
        .innerJoin(liftWorkoutExercises, eq(liftWorkoutExercises.id, liftSets.workoutExerciseId))
        .innerJoin(w, eq(w.id, liftWorkoutExercises.workoutId))
        .where(visible)
        .orderBy(asc(liftSets.workoutExerciseId), asc(liftSets.position)),
      db.select().from(liftBodyweights).orderBy(asc(liftBodyweights.measuredAt)),
    ]);
  return buildSnapshot({
    customExercises,
    muscles,
    templateFolders,
    templates,
    templateExercises,
    workouts,
    workoutExercises: wes.map((r) => r.we),
    sets: sets.map((r) => r.s),
    bodyweights,
  });
}
