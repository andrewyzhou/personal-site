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
  unique,
} from "drizzle-orm/pg-core";
import { isNotNull } from "drizzle-orm";
import type { ReplayData } from "../replay/build";
import type { ActivityMetrics } from "../metrics/types";
import type { SiteEditTimes, UpstreamSnapshot } from "../metadata-merge";

export interface RouteBounds {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
}

// a stretch of the activity hidden by a privacy zone. entry/exit are the last
// and first published points around it (null when it starts/ends in the fog).
export interface FogEvent {
  entry: [number, number] | null; // [lat, lng]
  exit: [number, number] | null;
  durationS: number; // rounded to the minute
}

// privacy settings (privacy_settings rows; latest wins)
export interface PrivacySettings {
  // distance of fogged activities: include the hidden part rounded, include it
  // exactly, or publish only the visible distance
  distance: { mode: "include-rounded" | "include-exact" | "visible-only"; roundToM: number };
  // floor the published start time to this many minutes (0 = exact)
  coarsenStartMin: number;
  // privacy trim at both ends for gps tracks without a trim edit
  defaultTrimM: number;
}

// cleaning + metrics settings (fixed defaults: DEFAULT_ACTIVITY_SETTINGS)
export interface ActivitySettings {
  // accept detector suggestions at or above this confidence without asking
  autoApply: { enabled: boolean; minConfidence: number };
  // heart rate zones: upper bounds of z1..z4 as fractions of max hr (z5 above)
  hrMaxBpm: number;
  hrZonePcts: number[];
  // effort (training load) uses resting hr; pace zones need a threshold pace.
  // optional: null when not set
  hrRestBpm?: number | null;
  thresholdPaceSPerKm?: number | null;
}

// stats straight from the untouched canonical track (device totals when the
// file has them), kept next to the cleaned published ones
export interface RawStats {
  distanceM: number;
  movingTimeS: number;
  elapsedTimeS: number;
  elevGainM: number;
  avgSpeedMs: number;
  maxSpeedMs: number;
  avgHr: number | null;
  maxHr: number | null;
}

export const activities = pgTable(
  "activities",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    name: text("name").notNull().default(""),
    // a site sport type: Run, Ride, WeightTraining… (src/lib/sport-types.ts)
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
    sufferScore: doublePrecision("suffer_score"), // imported "relative effort" from the old archive; null for new uploads
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
    externalId: text("external_id"), // upstream activity id (archive id or intervals.icu id), as text
    // sha256(`${startEpochSec}:${elapsedTimeS}`) over PRE-trim values so re-uploads
    // always collide regardless of trim settings; inserts are conflict-do-nothing
    dedupeKey: text("dedupe_key").notNull().unique(),
    hidden: boolean("hidden").notNull().default(false),
    // republish bookkeeping (src/lib/republish.ts is the only writer of the
    // published route/stat columns above). 0 = legacy pipeline output
    processingVersion: integer("processing_version").notNull().default(0),
    publishedInputsHash: text("published_inputs_hash"),
    canonicalTrackKey: text("canonical_track_key"), // private bucket key, never public
    // visibility (private = hidden). applied by the public serializer, so
    // toggling never touches published data and is always restorable
    mapHidden: boolean("map_hidden").notNull().default(false),
    hrHidden: boolean("hr_hidden").notNull().default(false),
    // published (possibly coarsened) start; null until republished → fall back
    publishedLocalTime: text("published_local_time"),
    publishedStartUtc: timestamp("published_start_utc", { withTimezone: true, mode: "date" }),
    // fog output (public): events at zone edges + the touched zones' public shapes
    fogEvents: jsonb("fog_events").$type<FogEvent[]>(),
    fogShapes: jsonb("fog_shapes").$type<number[][][][]>(),
    // PRIVATE: bounds of the full unfogged track, used to find zones that touch it
    trackBbox: jsonb("track_bbox").$type<RouteBounds>(),
    // set by zone/settings/photo edits; the rebuild job republishes and clears it
    needsRepublish: boolean("needs_republish").notNull().default(false),
    // when an edit last marked this row stale; republish only clears
    // needs_republish if nothing marked it after the republish started
    staleMarkedAt: timestamp("stale_marked_at", { withTimezone: true, mode: "date" }),
    // PRIVATE: the route as first written by an ingest path (before fog), kept so
    // trackless rows can be fogged now and restored when zones change
    legacyRoute: jsonb("legacy_route").$type<{ polyline: string | null; cardPolyline: string | null; bounds: RouteBounds | null }>(),
    // cleaning (written by republish): stats of the untouched track, and
    // seconds per heart-rate zone of the published track (hidden with hr)
    rawStats: jsonb("raw_stats").$type<RawStats>(),
    hrZonesS: jsonb("hr_zones_s").$type<number[]>(),
    // set on the second half of a split: the activity it was split from
    splitFromId: bigint("split_from_id", { mode: "number" }),
    // newest edit wins (src/lib/metadata-merge.ts): when the site last edited
    // name / description / sport type / hidden, and the upstream values the
    // last sync saw. null = never edited / never synced
    metaEditedAt: jsonb("meta_edited_at").$type<SiteEditTimes>(),
    upstreamMeta: jsonb("upstream_meta").$type<UpstreamSnapshot>(),
    // last rebuild-job attempt: failing rows go to the back of the queue
    republishAttemptedAt: timestamp("republish_attempted_at", { withTimezone: true, mode: "date" }),
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
    // private raw-store copy of the photo bytes (set by migrate-originals-private)
    originalSha256: text("original_sha256"),
    // PRIVATE: from the original's exif (never selected by public routes)
    takenAt: timestamp("taken_at", { withTimezone: true, mode: "date" }),
    gpsLat: doublePrecision("gps_lat"),
    gpsLng: doublePrecision("gps_lng"),
    // public map pin, written by republish: null inside zones, hidden or trimmed parts
    pinLat: doublePrecision("pin_lat"),
    pinLng: doublePrecision("pin_lng"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [index("activity_photos_activity_idx").on(t.activityId, t.position)]
);

// ---------------------------------------------------------------------------
// activities v2 data layer. raw inputs are content-addressed and write-once in a
// private bucket; everything public is regenerated from them by republish().

// manifest of every object in the private raw bucket. sha256 of the exact bytes
// is the identity; rows are insert-only (conflict-do-nothing), never updated.
export const rawObjects = pgTable(
  "raw_objects",
  {
    sha256: text("sha256").primaryKey(),
    key: text("key").notNull().unique(), // object key in R2_RAW_BUCKET
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    contentType: text("content_type").notNull(),
    // what the bytes are: 'device-file' | 'strava-detail' | 'strava-streams' |
    // 'strava-laps' | 'strava-photos' | 'intervals-activity' | 'strava-export-file' |
    // 'strava-export-manifest' | 'photo-original' | 'text' | …
    kind: text("kind").notNull(),
    originalFilename: text("original_filename"),
    // where the bytes came from (export path, api url, legacy public pathname…)
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [index("raw_objects_kind_idx").on(t.kind)]
);

// many sources per activity (replaces the single source/external_id pair, which
// stays on activities for now). one row per (activity, provider identity, kind,
// raw object); a newer snapshot of the same kind is a new row, latest wins.
// raw_sha256 is deliberately not a foreign key: backfilled rows reference
// originals still being copied into the raw store (the integrity audit checks it).
export const activitySources = pgTable(
  "activity_sources",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    activityId: bigint("activity_id", { mode: "number" })
      .notNull()
      .references(() => activities.id, { onDelete: "cascade" }),
    // 'strava' | 'intervals-icu' | 'upload' | 'manual'
    provider: text("provider").notNull(),
    externalId: text("external_id"),
    // 'device-file' | 'strava-streams' | 'strava-detail' | 'strava-laps' |
    // 'strava-photos' | 'intervals-activity' | 'summary'
    kind: text("kind").notNull(),
    rawSha256: text("raw_sha256"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    unique("activity_sources_identity_uq")
      .on(t.activityId, t.provider, t.externalId, t.kind, t.rawSha256)
      .nullsNotDistinct(),
    index("activity_sources_activity_idx").on(t.activityId),
    index("activity_sources_external_idx").on(t.provider, t.externalId),
    index("activity_sources_raw_idx").on(t.rawSha256),
  ]
);

// declarative, revertible edits applied at publish time. never deleted: a revert
// stamps reverted_at, and republish ignores reverted rows.
//   trim     { startM, endM }
//   cut      { fromS, toS }            (A2)
//   split    { atS }                   (A2)
//   merge    { withActivityId }        (A2)
//   override { field: value, … }       (whitelisted published stat fields)
export const activityEdits = pgTable(
  "activity_edits",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    activityId: bigint("activity_id", { mode: "number" })
      .notNull()
      .references(() => activities.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    params: jsonb("params").$type<Record<string, unknown>>().notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    revertedAt: timestamp("reverted_at", { withTimezone: true, mode: "date" }),
  },
  (t) => [index("activity_edits_activity_idx").on(t.activityId, t.id)]
);

// private polygons. applied only at publish time (A1); never shipped to clients.
export const privacyZones = pgTable("privacy_zones", {
  id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
  name: text("name").notNull().default(""),
  // geojson Polygon coordinates: rings of [lng, lat]
  polygon: jsonb("polygon").$type<number[][][]>().notNull(),
  enabled: boolean("enabled").notNull().default(true),
  // geometry is never edited in place: an edit inserts a new row that replaces
  // this one and archives it, so every earlier shape stays restorable
  replacesId: bigint("replaces_id", { mode: "number" }),
  archivedAt: timestamp("archived_at", { withTimezone: true, mode: "date" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

// detector output: proposed cleaning edits for the owner to accept or dismiss.
// insert-only per (activity, detector version, fingerprint); decisions stamp
// status. accepting creates an activity_edits row (edit_id), so undo = revert it.
export const activitySuggestions = pgTable(
  "activity_suggestions",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    activityId: bigint("activity_id", { mode: "number" })
      .notNull()
      .references(() => activities.id, { onDelete: "cascade" }),
    detectorVersion: integer("detector_version").notNull(),
    // stable hash of (kind, edit) so re-detection never duplicates
    fingerprint: text("fingerprint").notNull(),
    // 'crop-head' | 'crop-tail' | 'cut-vehicle' | 'drop-spikes' | 'no-gps' | 'idle'
    kind: text("kind").notNull(),
    confidence: doublePrecision("confidence").notNull(),
    // the activity_edits row this would create: { kind, params } (null = info only)
    edit: jsonb("edit").$type<{ kind: string; params: Record<string, unknown> } | null>(),
    summary: text("summary").notNull(),
    range: jsonb("range").$type<{ fromS: number; toS: number } | null>(),
    status: text("status").notNull().default("open"), // 'open' | 'accepted' | 'dismissed'
    editId: bigint("edit_id", { mode: "number" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    decidedAt: timestamp("decided_at", { withTimezone: true, mode: "date" }),
  },
  (t) => [
    uniqueIndex("activity_suggestions_fp_idx").on(t.activityId, t.detectorVersion, t.fingerprint),
    index("activity_suggestions_activity_idx").on(t.activityId, t.status),
  ]
);

// published replay track (timed, post-cleaning/trim/fog), one row per activity,
// written only by republish. kept out of activities so list queries stay small.
export const activityReplays = pgTable("activity_replays", {
  activityId: bigint("activity_id", { mode: "number" })
    .primaryKey()
    .references(() => activities.id, { onDelete: "cascade" }),
  data: jsonb("data").$type<ReplayData>(), // null: nothing to replay
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

// per-activity metrics (splits, best efforts, curves, zones, effort, climbs),
// computed by republish from the published track only. one row per activity.
export const activityMetrics = pgTable("activity_metrics", {
  activityId: bigint("activity_id", { mode: "number" })
    .primaryKey()
    .references(() => activities.id, { onDelete: "cascade" }),
  data: jsonb("data").$type<ActivityMetrics>(), // null: no timed track
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

export type ActivitySuggestionRow = typeof activitySuggestions.$inferSelect;

// insert-only; the newest row is in effect (restore = insert an older value)
export const privacySettings = pgTable("privacy_settings", {
  id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
  settings: jsonb("settings").$type<PrivacySettings>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

export type RawObjectRow = typeof rawObjects.$inferSelect;
export type ActivitySourceRow = typeof activitySources.$inferSelect;
export type NewActivitySourceRow = typeof activitySources.$inferInsert;
export type ActivityEditRow = typeof activityEdits.$inferSelect;
export type PrivacyZoneRow = typeof privacyZones.$inferSelect;

export type ActivityRow = typeof activities.$inferSelect;
export type NewActivityRow = typeof activities.$inferInsert;
export type ActivityPhotoRow = typeof activityPhotos.$inferSelect;

// ---------------------------------------------------------------------------
// engagement: per-target counters (claps/views). targets are
// (target_type, target_slug): blog:<slug>, photos:<slug>, activity:<id>.

// claps + views as counter rows (kind: 'clap' | 'view')
export const counters = pgTable(
  "counters",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    targetType: text("target_type").notNull(),
    targetSlug: text("target_slug").notNull(),
    kind: text("kind").notNull(),
    count: bigint("count", { mode: "number" }).notNull().default(0),
  },
  (t) => [uniqueIndex("counters_unique_idx").on(t.targetType, t.targetSlug, t.kind)]
);


export * from "./lift-schema";
export * from "./listening-schema";
export * from "./sync-schema";
export * from "./drafts-schema";
