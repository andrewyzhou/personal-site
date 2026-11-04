// updatedAt that never goes backwards for a row, even if the phone clock is
// set back (manual change, ntp correction, travel). last-write-wins on the
// server compares these, so an edit must always beat the one before it.

import { sql, type AnyColumn, type SQL } from "drizzle-orm";

/** max(now, prev + 1): strictly after the row's previous stamp */
export function stamp(prev?: number | null, now: number = Date.now()): number {
  return Math.max(now, (prev ?? 0) + 1);
}

/**
 * stamp() in sql for an update's set(), so the row's own updated_at is read
 * in the same statement and callers don't need a select first.
 */
export function bumpedAt(column: AnyColumn, now: number = Date.now()): SQL<number> {
  return sql<number>`max(${now}, coalesce(${column}, 0) + 1)`;
}
