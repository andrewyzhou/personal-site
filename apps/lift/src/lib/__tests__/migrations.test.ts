/// <reference types="node" />
// the app tsconfig loads no node types; this test needs node:sqlite's.
// runs the hand-written migrations against node's built-in sqlite and checks
// they match the drizzle schema, since drizzle-kit isn't used to generate them.

import { DatabaseSync } from "node:sqlite";
import { getTableConfig, type SQLiteTable } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import { MIGRATIONS, SCHEMA_VERSION, pendingMigrations } from "../../db/migrations";
import { customExercises, outbox, sets, workoutExercises, workouts } from "../../db/schema";

function migrated(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const m of pendingMigrations(0)) {
    db.exec("BEGIN");
    for (const s of m.statements) db.exec(s);
    db.exec(`PRAGMA user_version = ${m.version}`);
    db.exec("COMMIT");
  }
  return db;
}

interface ColInfo {
  name: string;
  notnull: number;
  pk: number;
}

describe("migrations", () => {
  it("pendingMigrations slices by user_version", () => {
    expect(pendingMigrations(0).map((m) => m.version)).toEqual(MIGRATIONS.map((_, i) => i + 1));
    expect(pendingMigrations(SCHEMA_VERSION)).toEqual([]);
  });

  it("ends at SCHEMA_VERSION", () => {
    const db = migrated();
    expect((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(SCHEMA_VERSION);
  });

  it.each([workouts, workoutExercises, sets, customExercises, outbox] as SQLiteTable[])(
    "matches the drizzle schema",
    (table) => {
      const db = migrated();
      const cfg = getTableConfig(table);
      const cols = db.prepare(`PRAGMA table_info("${cfg.name}")`).all() as unknown as ColInfo[];
      expect(cols.map((c) => c.name).sort()).toEqual(cfg.columns.map((c) => c.name).sort());
      for (const col of cfg.columns) {
        const info = cols.find((c) => c.name === col.name)!;
        expect({ col: col.name, notNull: col.notNull || col.primary }).toEqual({
          col: col.name,
          notNull: info.notnull === 1 || info.pk === 1,
        });
      }
      const idx = (db.prepare(`PRAGMA index_list("${cfg.name}")`).all() as { name: string; origin: string }[])
        .filter((i) => i.origin === "c")
        .map((i) => i.name)
        .sort();
      expect(idx).toEqual(cfg.indexes.map((i) => i.config.name).sort());
    }
  );

  it("cascades deletes and enforces checks", () => {
    const db = migrated();
    db.exec(`INSERT INTO workouts (id, started_at, created_at, updated_at) VALUES ('w', 1, 1, 1)`);
    db.exec(
      `INSERT INTO workout_exercises (id, workout_id, exercise_id, position, created_at, updated_at) VALUES ('we', 'w', 'squat', 0, 1, 1)`
    );
    db.exec(`INSERT INTO sets (id, workout_exercise_id, position, created_at, updated_at) VALUES ('s', 'we', 0, 1, 1)`);
    expect(() => db.exec(`UPDATE sets SET kind = 'heavy' WHERE id = 's'`)).toThrow();
    expect(() => db.exec(`UPDATE workouts SET status = 'paused' WHERE id = 'w'`)).toThrow();
    expect(() =>
      db.exec(`INSERT INTO sets (id, workout_exercise_id, position, created_at, updated_at) VALUES ('x', 'nope', 0, 1, 1)`)
    ).toThrow();
    db.exec(`DELETE FROM workouts WHERE id = 'w'`);
    expect((db.prepare("SELECT count(*) AS n FROM sets").get() as { n: number }).n).toBe(0);
  });
});
