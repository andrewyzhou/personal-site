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
} from "drizzle-orm/pg-core";
import { isNotNull } from "drizzle-orm";

export interface RouteBounds {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
}

export const activities = pgTable(
  "activities",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    name: text("name").notNull().default(""),
    // strava-style keys: Run, Ride, WeightTraining… (matches ACTIVITY_ICONS in ActivityCalendar.tsx)
    sportType: text("sport_type").notNull(),
    startDateUtc: timestamp("start_date_utc", { withTimezone: true, mode: "date" }).notNull(),
    localDate: text("local_date").notNull(), // 'YYYY-MM-DD' (mirrors CalendarActivity.date)
    localTime: text("local_time").notNull(), // 'HH:MM'      (mirrors CalendarActivity.startTime)
    utcOffsetMin: integer("utc_offset_min").notNull().default(0),
    // published (post-trim) stats
    distanceM: doublePrecision("distance_m").notNull().default(0),
    movingTimeS: integer("moving_time_s").notNull().default(0),
    elapsedTimeS: integer("elapsed_time_s").notNull().default(0),
    elevGainM: doublePrecision("elev_gain_m").notNull().default(0),
    avgSpeedMs: doublePrecision("avg_speed_ms").notNull().default(0),
    maxSpeedMs: doublePrecision("max_speed_ms").notNull().default(0),
    avgHr: doublePrecision("avg_hr"), // null = not recorded
    maxHr: doublePrecision("max_hr"),
    avgCadence: doublePrecision("avg_cadence"), // stored raw as the device reports it
    avgWatts: doublePrecision("avg_watts"),
    maxWatts: doublePrecision("max_watts"),
    kilojoules: doublePrecision("kilojoules"),
    description: text("description"),
    sufferScore: doublePrecision("suffer_score"), // imported strava "relative effort"; null for new uploads
    gear: text("gear"), // free text, e.g. 'pegasus 41'
    // published route (post-trim)
    polyline: text("polyline"), // google encoded polyline, precision 5, rdp ≤ 1500 pts (detail page)
    cardPolyline: text("card_polyline"), // same encoding, rdp ≤ 100 pts (svg thumbnails)
    bounds: jsonb("bounds").$type<RouteBounds>(), // bounds of the PUBLISHED route
    trimStartM: doublePrecision("trim_start_m").notNull().default(0),
    trimEndM: doublePrecision("trim_end_m").notNull().default(0),
    // original file (never trimmed, never mutated), stored in r2
    fitBlobUrl: text("fit_blob_url"),
    fitBlobPathname: text("fit_blob_pathname"),
    fitSha256: text("fit_sha256"),
    fileType: text("file_type"), // 'fit' | 'gpx' | 'tcx' | null (csv-only manual imports)
    source: text("source").notNull().default("upload"), // 'upload' | 'strava-archive' | 'intervals-icu' | 'manual'
    externalId: text("external_id"), // strava activity id or intervals.icu id, as text
    // sha256(`${startEpochSec}:${elapsedTimeS}`) over PRE-trim values so re-uploads
    // always collide regardless of trim settings; inserts are conflict-do-nothing
    dedupeKey: text("dedupe_key").notNull().unique(),
    hidden: boolean("hidden").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("activities_external_id_idx").on(t.externalId).where(isNotNull(t.externalId)),
    index("activities_local_date_idx").on(t.localDate.desc()),
    index("activities_start_date_idx").on(t.startDateUtc.desc()),
  ]
);

export const activityPhotos = pgTable(
  "activity_photos",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    activityId: bigint("activity_id", { mode: "number" })
      .notNull()
      .references(() => activities.id, { onDelete: "cascade" }),
    blobUrl: text("blob_url").notNull(),
    blobPathname: text("blob_pathname").notNull(),
    width: integer("width"),
    height: integer("height"),
    position: integer("position").notNull().default(0),
    caption: text("caption"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [index("activity_photos_activity_idx").on(t.activityId, t.position)]
);

export type ActivityRow = typeof activities.$inferSelect;
export type NewActivityRow = typeof activities.$inferInsert;
export type ActivityPhotoRow = typeof activityPhotos.$inferSelect;
