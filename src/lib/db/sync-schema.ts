import { pgTable, bigint, text, timestamp, integer, jsonb, index } from "drizzle-orm/pg-core";

// append-only log of what every sync did: each external api call, each
// import/merge/update decision, each error. written in batches per run
// (src/lib/sync-log.ts), read with scripts/sync-log.mts. activity_id has no
// foreign key on purpose: the log outlives the rows it talks about.
export const syncEvents = pgTable(
  "sync_events",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    at: timestamp("at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    runId: text("run_id").notNull(),
    // cron | poll | manual | telegram | webhook | script
    trigger: text("trigger").notNull(),
    // intervals | garmin | spotify | lift | activities | republish …
    source: text("source").notNull(),
    // api_call | insert | merge | attach | update_field | skip | error | run_start | run_end
    kind: text("kind").notNull(),
    activityId: bigint("activity_id", { mode: "number" }),
    externalId: text("external_id"),
    detail: jsonb("detail").$type<Record<string, unknown>>(),
    durationMs: integer("duration_ms"),
  },
  (t) => [
    index("sync_events_at_idx").on(t.at),
    index("sync_events_run_idx").on(t.runId),
    index("sync_events_activity_idx").on(t.activityId),
  ]
);

export type SyncEventRow = typeof syncEvents.$inferSelect;
export type NewSyncEventRow = typeof syncEvents.$inferInsert;
