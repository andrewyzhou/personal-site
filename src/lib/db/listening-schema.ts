import {
  pgTable,
  bigint,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { isNotNull } from "drizzle-orm";

// listening history (spotify). every api response and export file used here is
// stored byte-for-byte in the private raw store first; these tables are derived
// from it and can be rebuilt. single user, private by default: nothing here is
// read by a public page.

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => ts("created_at").notNull().defaultNow();
const updatedAt = () => ts("updated_at").notNull().defaultNow();

export type ListeningSource = "api-recent" | "export-extended" | "export-basic";
export type ListeningItemType = "track" | "episode" | "audiobook" | "unknown";

export interface SpotifyImage {
  url: string;
  width: number | null;
  height: number | null;
}

// one row per play. a play seen by both the api and an export is one row: the
// export's exact ms_played / skip / reason fields win, the api keeps context.
// each source has its own dedupe key so re-runs of either are no-ops.
export const listeningPlays = pgTable(
  "listening_plays",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    // the source the play-level fields come from (export once one has merged)
    source: text("source").$type<ListeningSource>().notNull(),
    // when playback of the item stopped (api played_at / export ts), utc
    playedAt: ts("played_at").notNull(),
    // played_at − ms_played (estimated when ms_played is)
    startedAt: ts("started_at"),
    itemType: text("item_type").$type<ListeningItemType>().notNull(),
    trackUri: text("track_uri"),
    trackId: text("track_id"),
    // names as the source reported them (metadata tables hold the canonical ones)
    trackName: text("track_name"),
    artistName: text("artist_name"),
    albumName: text("album_name"),
    episodeUri: text("episode_uri"),
    episodeName: text("episode_name"),
    showName: text("show_name"),
    audiobookUri: text("audiobook_uri"),
    audiobookTitle: text("audiobook_title"),
    audiobookChapterUri: text("audiobook_chapter_uri"),
    audiobookChapterTitle: text("audiobook_chapter_title"),
    msPlayed: integer("ms_played"),
    msPlayedEstimated: boolean("ms_played_estimated").notNull().default(false),
    skipped: boolean("skipped"),
    reasonStart: text("reason_start"),
    reasonEnd: text("reason_end"),
    shuffle: boolean("shuffle"),
    offline: boolean("offline"),
    // export offline_timestamp exactly as given (epoch, unit varies by export)
    offlineTimestamp: bigint("offline_timestamp", { mode: "number" }),
    incognito: boolean("incognito"),
    platform: text("platform"),
    country: text("country"),
    // playlist / album / artist the api says the play came from
    contextType: text("context_type"),
    contextUri: text("context_uri"),
    // raw links: the api page / export file the row came from + index in it
    apiRawSha256: text("api_raw_sha256"),
    apiRawIndex: integer("api_raw_index"),
    exportRawSha256: text("export_raw_sha256"),
    exportRawIndex: integer("export_raw_index"),
    // dedupe keys (see src/lib/listening/normalize.ts): api `api:<uri>@<played_at>`,
    // export `ext:<item>@<ts>:<ms>` / `basic:<artist|track>@<endTime>:<ms>`
    apiDedupeKey: text("api_dedupe_key"),
    exportDedupeKey: text("export_dedupe_key"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("listening_plays_played_at_idx").on(t.playedAt.desc()),
    index("listening_plays_track_id_idx").on(t.trackId),
    uniqueIndex("listening_plays_api_key_idx").on(t.apiDedupeKey).where(isNotNull(t.apiDedupeKey)),
    uniqueIndex("listening_plays_export_key_idx").on(t.exportDedupeKey).where(isNotNull(t.exportDedupeKey)),
  ]
);

// metadata cache, keyed by spotify id. raw_sha256 = the response it came from.
export const listeningTracks = pgTable("listening_tracks", {
  id: text("id").primaryKey(),
  uri: text("uri").notNull(),
  name: text("name").notNull(),
  durationMs: integer("duration_ms"),
  albumId: text("album_id"),
  artistIds: jsonb("artist_ids").$type<string[]>().notNull().default([]),
  artistNames: jsonb("artist_names").$type<string[]>().notNull().default([]),
  explicit: boolean("explicit"),
  popularity: integer("popularity"),
  isrc: text("isrc"),
  discNumber: integer("disc_number"),
  trackNumber: integer("track_number"),
  isLocal: boolean("is_local"),
  rawSha256: text("raw_sha256"),
  fetchedAt: ts("fetched_at").notNull(),
  // true once a full /tracks lookup (not just an embedded object) filled it
  complete: boolean("complete").notNull().default(false),
});

export const listeningArtists = pgTable("listening_artists", {
  id: text("id").primaryKey(),
  uri: text("uri").notNull(),
  name: text("name").notNull(),
  genres: jsonb("genres").$type<string[]>(),
  popularity: integer("popularity"),
  followers: integer("followers"),
  images: jsonb("images").$type<SpotifyImage[]>(),
  rawSha256: text("raw_sha256"),
  fetchedAt: ts("fetched_at").notNull(),
  // false while only the simplified object (id + name) embedded in a track is known
  complete: boolean("complete").notNull().default(false),
});

export const listeningAlbums = pgTable("listening_albums", {
  id: text("id").primaryKey(),
  uri: text("uri").notNull(),
  name: text("name").notNull(),
  albumType: text("album_type"),
  releaseDate: text("release_date"), // as given: 'YYYY', 'YYYY-MM' or 'YYYY-MM-DD'
  releaseDatePrecision: text("release_date_precision"),
  totalTracks: integer("total_tracks"),
  artistIds: jsonb("artist_ids").$type<string[]>().notNull().default([]),
  genres: jsonb("genres").$type<string[]>(),
  label: text("label"),
  popularity: integer("popularity"),
  images: jsonb("images").$type<SpotifyImage[]>(),
  rawSha256: text("raw_sha256"),
  fetchedAt: ts("fetched_at").notNull(),
  complete: boolean("complete").notNull().default(false),
});

export interface ListeningRunStats {
  pages: number;
  fetched: number;
  inserted: number;
  merged: number;
  duplicates: number;
  estimated: number;
  metadata: { tracks: number; artists: number; albums: number; failed: number };
  possibleGap: boolean;
  durationMs: number;
}

// one row per collector ('spotify-recent')
export const listeningSyncState = pgTable("listening_sync_state", {
  id: text("id").primaryKey(),
  // newest played_at stored so far; the next run asks for plays after it
  cursorPlayedAt: ts("cursor_played_at"),
  lastRunAt: ts("last_run_at"),
  lastRunStatus: text("last_run_status"), // 'ok' | 'error'
  lastError: text("last_error"),
  lastRunStats: jsonb("last_run_stats").$type<ListeningRunStats>(),
  lastSuccessAt: ts("last_success_at"),
  updatedAt: updatedAt(),
});

// one row per applied export import (insert-only), for the admin summary
export const listeningImports = pgTable(
  "listening_imports",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    zipSha256: text("zip_sha256").notNull(),
    filename: text("filename"),
    summary: jsonb("summary").$type<Record<string, unknown>>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("listening_imports_created_idx").on(t.createdAt.desc())]
);

export type ListeningPlayRow = typeof listeningPlays.$inferSelect;
export type ListeningPlayInsert = typeof listeningPlays.$inferInsert;
export type ListeningSyncStateRow = typeof listeningSyncState.$inferSelect;
