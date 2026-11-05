import { sqliteTable, text, integer, real, index } from "drizzle-orm/sqlite-core";
import type { Equipment, SetKind, SyncEntity, TrackingType, WeightUnit } from "lift-core";

// local mirror of the server lift tables, shaped for the later push-only sync.
// ids are client uuids so rows keep their identity when pushed. timestamps are
// epoch ms integers (not drizzle's timestamp mode) so the outbox payload and the
// server see the exact stored value. the ddl lives in migrations.ts; a test
// checks the two agree.

export type WorkoutStatus = "active" | "finished" | "discarded";

export const workouts = sqliteTable(
  "workouts",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull().default(""),
    startedAt: integer("started_at").notNull(),
    endedAt: integer("ended_at"),
    // device offset at start (minutes east of utc), so the server can rebuild wall time
    utcOffsetMin: integer("utc_offset_min"),
    templateId: text("template_id"),
    status: text("status").$type<WorkoutStatus>().notNull().default("active"),
    notes: text("notes"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("workouts_status_idx").on(t.status), index("workouts_started_at_idx").on(t.startedAt)]
);

export const workoutExercises = sqliteTable(
  "workout_exercises",
  {
    id: text("id").primaryKey(),
    workoutId: text("workout_id")
      .notNull()
      .references(() => workouts.id, { onDelete: "cascade" }),
    // lift-core catalog slug or a custom_exercises id; no fk because catalog
    // entries live in code, not in a table
    exerciseId: text("exercise_id").notNull(),
    position: integer("position").notNull(),
    notes: text("notes"),
    supersetGroup: integer("superset_group"),
    // rest seconds after each set; null = the app default
    restS: integer("rest_s"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    index("workout_exercises_workout_idx").on(t.workoutId, t.position),
    index("workout_exercises_exercise_idx").on(t.exerciseId),
  ]
);

export const sets = sqliteTable(
  "sets",
  {
    id: text("id").primaryKey(),
    workoutExerciseId: text("workout_exercise_id")
      .notNull()
      .references(() => workoutExercises.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    kind: text("kind").$type<SetKind>().notNull().default("normal"),
    weight: real("weight"),
    unit: text("unit").$type<WeightUnit>().notNull().default("lb"),
    reps: integer("reps"),
    durationS: integer("duration_s"),
    distanceM: real("distance_m"),
    rpe: real("rpe"),
    completed: integer("completed").notNull().default(0),
    note: text("note"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("sets_workout_exercise_idx").on(t.workoutExerciseId, t.position)]
);

export const customExercises = sqliteTable("custom_exercises", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  equipment: text("equipment").$type<Equipment>().notNull().default("other"),
  tracking: text("tracking").$type<TrackingType>().notNull().default("weight_reps"),
  // json arrays of MuscleRegion; parsed at the repository edge
  primary: text("primary").notNull().default("[]"),
  secondary: text("secondary").notNull().default("[]"),
  archived: integer("archived").notNull().default(0),
  mergedInto: text("merged_into"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export type OutboxEntity = SyncEntity;
export type OutboxOp = "insert" | "update" | "delete";

// every mutation appends here in the same transaction, so the future sync can
// replay changes in order without diffing tables
export const outbox = sqliteTable(
  "outbox",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    entity: text("entity").$type<OutboxEntity>().notNull(),
    entityId: text("entity_id").notNull(),
    op: text("op").$type<OutboxOp>().notNull(),
    payload: text("payload").notNull(),
    createdAt: integer("created_at").notNull(),
    syncedAt: integer("synced_at"),
    // server refusal reason, kept for inspection; the row still counts as synced
    rejected: text("rejected"),
  },
  (t) => [index("outbox_unsynced_idx").on(t.syncedAt, t.id)]
);

export const templateFolders = sqliteTable("template_folders", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  position: integer("position").notNull().default(0),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const templates = sqliteTable(
  "templates",
  {
    id: text("id").primaryKey(),
    folderId: text("folder_id").references(() => templateFolders.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    notes: text("notes"),
    position: integer("position").notNull().default(0),
    archived: integer("archived").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("templates_folder_idx").on(t.folderId, t.position)]
);

export const templateExercises = sqliteTable(
  "template_exercises",
  {
    id: text("id").primaryKey(),
    templateId: text("template_id")
      .notNull()
      .references(() => templates.id, { onDelete: "cascade" }),
    exerciseId: text("exercise_id").notNull(),
    position: integer("position").notNull(),
    supersetGroup: integer("superset_group"),
    restS: integer("rest_s"),
    // json array of PlannedSetPayload (lift-core sync.ts)
    plannedSets: text("planned_sets").notNull().default("[]"),
    notes: text("notes"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("template_exercises_template_idx").on(t.templateId, t.position)]
);

export const bodyweights = sqliteTable(
  "bodyweights",
  {
    id: text("id").primaryKey(),
    measuredAt: integer("measured_at").notNull(),
    weight: real("weight").notNull(),
    unit: text("unit").$type<WeightUnit>().notNull().default("lb"),
    note: text("note"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("bodyweights_measured_idx").on(t.measuredAt)]
);

export const programs = sqliteTable(
  "programs",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    // json text of lift-core ProgramData; parsed at the repository edge
    data: text("data").notNull().default("{}"),
    // the one program home's "next up" follows
    active: integer("active").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("programs_active_idx").on(t.active)]
);

// small local settings: device id, sync cursor, default rest, unit, server url
export const kv = sqliteTable("kv", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export type TemplateFolderRow = typeof templateFolders.$inferSelect;
export type TemplateRow = typeof templates.$inferSelect;
export type TemplateExerciseRow = typeof templateExercises.$inferSelect;
export type BodyweightRow = typeof bodyweights.$inferSelect;
export type ProgramRow = typeof programs.$inferSelect;

export type WorkoutRow = typeof workouts.$inferSelect;
export type WorkoutExerciseRow = typeof workoutExercises.$inferSelect;
export type SetRow = typeof sets.$inferSelect;
export type CustomExerciseRow = typeof customExercises.$inferSelect;
export type OutboxRow = typeof outbox.$inferSelect;
