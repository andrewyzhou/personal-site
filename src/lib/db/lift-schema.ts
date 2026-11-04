import {
  pgTable,
  bigint,
  text,
  timestamp,
  integer,
  doublePrecision,
  boolean,
  jsonb,
  index,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/pg-core";
import { isNotNull } from "drizzle-orm";
import { activities } from "./schema";

// lifting tracker. text primary keys everywhere: ids are derived from content
// (share link slug, sha of the raw share) so an ingest is a single db.batch
// with no id round-trips, and the phone app can later push its own uuids.

const createdAt = () =>
  timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow();

export interface LiftWarning {
  line: number;
  message: string;
  text: string;
}

export interface PlannedSet {
  kind?: string;
  weight?: number | null;
  unit?: string | null;
  reps?: number | null;
  durationS?: number | null;
  distanceM?: number | null;
}

export const exercises = pgTable("exercises", {
  // lift-core catalog slug, or "custom-<hash of normalized name>"
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  equipment: text("equipment").notNull().default("other"),
  category: text("category").notNull().default("strength"),
  tracking: text("tracking").notNull().default("weight_reps"),
  source: text("source").notNull(), // 'catalog' | 'import' | 'app'
  isCustom: boolean("is_custom").notNull().default(false),
  archived: boolean("archived").notNull().default(false),
  freeDbId: text("free_db_id"),
  // set when a custom exercise is folded into another one; rows keep pointing here
  mergedInto: text("merged_into"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const exerciseAliases = pgTable(
  "exercise_aliases",
  {
    exerciseId: text("exercise_id")
      .notNull()
      .references(() => exercises.id, { onDelete: "cascade" }),
    alias: text("alias").notNull(),
    normalized: text("normalized").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.exerciseId, t.normalized] }),
    index("exercise_aliases_normalized_idx").on(t.normalized),
  ]
);

export const exerciseMuscles = pgTable(
  "exercise_muscles",
  {
    exerciseId: text("exercise_id")
      .notNull()
      .references(() => exercises.id, { onDelete: "cascade" }),
    region: text("region").notNull(),
    role: text("role").notNull(), // 'primary' | 'secondary'
  },
  (t) => [primaryKey({ columns: [t.exerciseId, t.region] })]
);

export const liftTemplates = pgTable("lift_templates", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  folder: text("folder"),
  notes: text("notes"),
  position: integer("position").notNull().default(0),
  archived: boolean("archived").notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const liftTemplateExercises = pgTable(
  "lift_template_exercises",
  {
    id: text("id").primaryKey(),
    templateId: text("template_id")
      .notNull()
      .references(() => liftTemplates.id, { onDelete: "cascade" }),
    exerciseId: text("exercise_id")
      .notNull()
      .references(() => exercises.id),
    position: integer("position").notNull().default(0),
    plannedSets: jsonb("planned_sets").$type<PlannedSet[]>().notNull().default([]),
    notes: text("notes"),
  },
  (t) => [index("lift_template_exercises_template_idx").on(t.templateId, t.position)]
);

export const liftIngests = pgTable(
  "lift_ingests",
  {
    // "ing_" + first 24 hex of sha256(raw)
    id: text("id").primaryKey(),
    source: text("source").notNull(), // 'shortcut' | 'telegram' | 'api'
    rawSha256: text("raw_sha256").notNull().unique(),
    // raw is sacred: never updated or deleted, so any parser fix can replay it
    rawText: text("raw_text").notNull(),
    // future pointer into the content-addressed raw_objects store; null until that lands
    rawObjectId: text("raw_object_id"),
    // not unique: an edited re-share of the same workout is a new ingest row
    shareSlug: text("share_slug"),
    workoutId: text("workout_id"),
    status: text("status").notNull(), // 'parsed' | 'empty'
    warnings: jsonb("warnings").$type<LiftWarning[]>().notNull().default([]),
    createdAt: createdAt(),
  },
  (t) => [index("lift_ingests_share_slug_idx").on(t.shareSlug)]
);

export const liftWorkouts = pgTable(
  "lift_workouts",
  {
    // "share-<slug>" when the share has a link, else "share-<first 16 hex of sha>"
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    startedLocal: text("started_local").notNull(), // 'YYYY-MM-DDTHH:MM' wall clock
    // from a linked watch recording's utc offset when there is one, else LIFT_TIMEZONE
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }),
    utcOffsetMin: integer("utc_offset_min"),
    endedAt: timestamp("ended_at", { withTimezone: true, mode: "date" }),
    durationS: integer("duration_s"), // only known from linked recordings
    notes: text("notes"),
    source: text("source").notNull(), // 'share-text' | 'app'
    latestIngestId: text("latest_ingest_id"),
    shareSlug: text("share_slug"),
    workingSets: integer("working_sets").notNull().default(0),
    volumeKg: doublePrecision("volume_kg").notNull().default(0),
    // region -> 0..1, most-loaded region = 1
    muscleLoad: jsonb("muscle_load").$type<Record<string, number>>().notNull().default({}),
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("lift_workouts_share_slug_idx").on(t.shareSlug).where(isNotNull(t.shareSlug)),
    index("lift_workouts_started_local_idx").on(t.startedLocal.desc()),
  ]
);

export const liftWorkoutExercises = pgTable(
  "lift_workout_exercises",
  {
    id: text("id").primaryKey(), // `${workoutId}:${i}`
    workoutId: text("workout_id")
      .notNull()
      .references(() => liftWorkouts.id, { onDelete: "cascade" }),
    exerciseId: text("exercise_id")
      .notNull()
      .references(() => exercises.id),
    position: integer("position").notNull(),
    nameRaw: text("name_raw").notNull(), // exactly as the share printed it
    notes: text("notes"),
    supersetGroup: integer("superset_group"),
  },
  (t) => [
    index("lift_workout_exercises_workout_idx").on(t.workoutId, t.position),
    index("lift_workout_exercises_exercise_idx").on(t.exerciseId),
  ]
);

export const liftSets = pgTable(
  "lift_sets",
  {
    id: text("id").primaryKey(), // `${workoutExerciseId}:${j}`
    workoutExerciseId: text("workout_exercise_id")
      .notNull()
      .references(() => liftWorkoutExercises.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    kind: text("kind").notNull(), // 'warmup' | 'normal' | 'drop' | 'failure'
    weight: doublePrecision("weight"), // as logged, in `unit`
    unit: text("unit"),
    weightKg: doublePrecision("weight_kg"),
    reps: integer("reps"),
    durationS: integer("duration_s"),
    distanceM: doublePrecision("distance_m"),
    rpe: doublePrecision("rpe"),
    bodyweight: boolean("bodyweight").notNull().default(false),
    note: text("note"),
    e1rmKg: doublePrecision("e1rm_kg"),
    completed: boolean("completed").notNull().default(true),
  },
  (t) => [index("lift_sets_workout_exercise_idx").on(t.workoutExerciseId, t.position)]
);

// m:n between workouts and watch recordings. linking only ever inserts here;
// the activities rows themselves are never touched by lift code.
export const liftWorkoutActivities = pgTable(
  "lift_workout_activities",
  {
    workoutId: text("workout_id")
      .notNull()
      .references(() => liftWorkouts.id, { onDelete: "cascade" }),
    activityId: bigint("activity_id", { mode: "number" })
      .notNull()
      .references(() => activities.id, { onDelete: "cascade" }),
    role: text("role").notNull(), // 'primary' | 'duplicate' | 'continuation' | 'overrun'
    method: text("method").notNull(), // 'auto' | 'manual'
    deltaMin: integer("delta_min").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.workoutId, t.activityId] }),
    index("lift_workout_activities_activity_idx").on(t.activityId),
  ]
);

export type ExerciseRow = typeof exercises.$inferSelect;
export type NewExerciseRow = typeof exercises.$inferInsert;
export type ExerciseAliasRow = typeof exerciseAliases.$inferSelect;
export type NewExerciseAliasRow = typeof exerciseAliases.$inferInsert;
export type ExerciseMuscleRow = typeof exerciseMuscles.$inferSelect;
export type NewExerciseMuscleRow = typeof exerciseMuscles.$inferInsert;
export type LiftTemplateRow = typeof liftTemplates.$inferSelect;
export type NewLiftTemplateRow = typeof liftTemplates.$inferInsert;
export type LiftTemplateExerciseRow = typeof liftTemplateExercises.$inferSelect;
export type NewLiftTemplateExerciseRow = typeof liftTemplateExercises.$inferInsert;
export type LiftIngestRow = typeof liftIngests.$inferSelect;
export type NewLiftIngestRow = typeof liftIngests.$inferInsert;
export type LiftWorkoutRow = typeof liftWorkouts.$inferSelect;
export type NewLiftWorkoutRow = typeof liftWorkouts.$inferInsert;
export type LiftWorkoutExerciseRow = typeof liftWorkoutExercises.$inferSelect;
export type NewLiftWorkoutExerciseRow = typeof liftWorkoutExercises.$inferInsert;
export type LiftSetRow = typeof liftSets.$inferSelect;
export type NewLiftSetRow = typeof liftSets.$inferInsert;
export type LiftWorkoutActivityRow = typeof liftWorkoutActivities.$inferSelect;
export type NewLiftWorkoutActivityRow = typeof liftWorkoutActivities.$inferInsert;
