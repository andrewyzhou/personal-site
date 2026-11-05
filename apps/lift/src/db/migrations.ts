// hand-written migrations. MIGRATIONS[i] takes the db from user_version i to
// i + 1. append only: never edit a shipped entry, add a new one instead.
// no expo imports here so the sql can be exercised under node:sqlite in tests.

export const MIGRATIONS: readonly (readonly string[])[] = [
  // 1: initial schema
  [
    `CREATE TABLE workouts (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'finished', 'discarded')),
      notes TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE INDEX workouts_status_idx ON workouts (status)`,
    `CREATE INDEX workouts_started_at_idx ON workouts (started_at)`,

    `CREATE TABLE workout_exercises (
      id TEXT PRIMARY KEY NOT NULL,
      workout_id TEXT NOT NULL REFERENCES workouts (id) ON DELETE CASCADE,
      exercise_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      notes TEXT,
      superset_group INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE INDEX workout_exercises_workout_idx ON workout_exercises (workout_id, position)`,
    `CREATE INDEX workout_exercises_exercise_idx ON workout_exercises (exercise_id)`,

    `CREATE TABLE sets (
      id TEXT PRIMARY KEY NOT NULL,
      workout_exercise_id TEXT NOT NULL REFERENCES workout_exercises (id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      kind TEXT NOT NULL DEFAULT 'normal' CHECK (kind IN ('warmup', 'normal', 'drop', 'failure')),
      weight REAL,
      unit TEXT NOT NULL DEFAULT 'lb' CHECK (unit IN ('lb', 'kg')),
      reps INTEGER,
      duration_s INTEGER,
      distance_m REAL,
      rpe REAL,
      completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
      note TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE INDEX sets_workout_exercise_idx ON sets (workout_exercise_id, position)`,

    `CREATE TABLE custom_exercises (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      equipment TEXT NOT NULL DEFAULT 'other',
      tracking TEXT NOT NULL DEFAULT 'weight_reps',
      "primary" TEXT NOT NULL DEFAULT '[]',
      secondary TEXT NOT NULL DEFAULT '[]',
      archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,

    `CREATE TABLE outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      entity TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      op TEXT NOT NULL CHECK (op IN ('insert', 'update', 'delete')),
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      synced_at INTEGER
    )`,
    `CREATE INDEX outbox_unsynced_idx ON outbox (synced_at, id)`,
  ],

  // 2: b2 logging mvp: timezone + template on workouts, per-exercise rest,
  // merges, templates/folders, bodyweight log, key-value settings, sync rejects
  [
    `ALTER TABLE workouts ADD COLUMN utc_offset_min INTEGER`,
    `ALTER TABLE workouts ADD COLUMN template_id TEXT`,
    `ALTER TABLE workout_exercises ADD COLUMN rest_s INTEGER`,
    `ALTER TABLE custom_exercises ADD COLUMN merged_into TEXT`,

    `CREATE TABLE template_folders (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,

    `CREATE TABLE templates (
      id TEXT PRIMARY KEY NOT NULL,
      folder_id TEXT REFERENCES template_folders (id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      notes TEXT,
      position INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE INDEX templates_folder_idx ON templates (folder_id, position)`,

    `CREATE TABLE template_exercises (
      id TEXT PRIMARY KEY NOT NULL,
      template_id TEXT NOT NULL REFERENCES templates (id) ON DELETE CASCADE,
      exercise_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      superset_group INTEGER,
      rest_s INTEGER,
      planned_sets TEXT NOT NULL DEFAULT '[]',
      notes TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE INDEX template_exercises_template_idx ON template_exercises (template_id, position)`,

    `CREATE TABLE bodyweights (
      id TEXT PRIMARY KEY NOT NULL,
      measured_at INTEGER NOT NULL,
      weight REAL NOT NULL,
      unit TEXT NOT NULL DEFAULT 'lb' CHECK (unit IN ('lb', 'kg')),
      note TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE INDEX bodyweights_measured_idx ON bodyweights (measured_at)`,

    `CREATE TABLE kv (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    )`,

    `ALTER TABLE outbox ADD COLUMN rejected TEXT`,
  ],

  // 3: b4 training programs. data is lift-core ProgramData json; template ids
  // inside it aren't fks, so a deleted template just shows as missing
  [
    `CREATE TABLE programs (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      data TEXT NOT NULL DEFAULT '{}',
      active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0, 1)),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE INDEX programs_active_idx ON programs (active)`,
  ],
];

export const SCHEMA_VERSION = MIGRATIONS.length;

/** migration batches still to apply for a db currently at `version` */
export function pendingMigrations(version: number): { version: number; statements: readonly string[] }[] {
  return MIGRATIONS.slice(Math.max(0, version)).map((statements, i) => ({
    version: Math.max(0, version) + i + 1,
    statements,
  }));
}
