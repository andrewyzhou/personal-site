import type { SQLiteDatabase } from "expo-sqlite";
import { SCHEMA_VERSION, pendingMigrations } from "./migrations";

/**
 * brings the db to SCHEMA_VERSION. each version runs in its own transaction
 * together with its user_version bump, so a crash mid-migration leaves the db
 * at the previous version rather than half-applied.
 */
export async function migrate(sqlite: SQLiteDatabase): Promise<void> {
  // both pragmas are no-ops inside a transaction, so they go first
  await sqlite.execAsync("PRAGMA journal_mode = WAL");
  await sqlite.execAsync("PRAGMA foreign_keys = ON");

  const row = await sqlite.getFirstAsync<{ user_version: number }>("PRAGMA user_version");
  const current = row?.user_version ?? 0;
  if (current > SCHEMA_VERSION) {
    // a newer build wrote this db (e.g. after a downgrade); don't guess at it
    throw new Error(`database is at version ${current}, app supports ${SCHEMA_VERSION}`);
  }

  for (const m of pendingMigrations(current)) {
    // non-exclusive transaction on purpose: an exclusive one opens a second
    // connection without foreign_keys. nothing else queries before ready.
    await sqlite.withTransactionAsync(async () => {
      for (const statement of m.statements) await sqlite.execAsync(statement);
      await sqlite.execAsync(`PRAGMA user_version = ${m.version}`);
    });
  }
}
