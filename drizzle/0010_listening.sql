CREATE TABLE "listening_albums" (
	"id" text PRIMARY KEY NOT NULL,
	"uri" text NOT NULL,
	"name" text NOT NULL,
	"album_type" text,
	"release_date" text,
	"release_date_precision" text,
	"total_tracks" integer,
	"artist_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"genres" jsonb,
	"label" text,
	"popularity" integer,
	"images" jsonb,
	"raw_sha256" text,
	"fetched_at" timestamp with time zone NOT NULL,
	"complete" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "listening_artists" (
	"id" text PRIMARY KEY NOT NULL,
	"uri" text NOT NULL,
	"name" text NOT NULL,
	"genres" jsonb,
	"popularity" integer,
	"followers" integer,
	"images" jsonb,
	"raw_sha256" text,
	"fetched_at" timestamp with time zone NOT NULL,
	"complete" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "listening_imports" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "listening_imports_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"zip_sha256" text NOT NULL,
	"filename" text,
	"summary" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "listening_plays" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "listening_plays_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"source" text NOT NULL,
	"played_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"item_type" text NOT NULL,
	"track_uri" text,
	"track_id" text,
	"track_name" text,
	"artist_name" text,
	"album_name" text,
	"episode_uri" text,
	"episode_name" text,
	"show_name" text,
	"audiobook_uri" text,
	"audiobook_title" text,
	"audiobook_chapter_uri" text,
	"audiobook_chapter_title" text,
	"ms_played" integer,
	"ms_played_estimated" boolean DEFAULT false NOT NULL,
	"skipped" boolean,
	"reason_start" text,
	"reason_end" text,
	"shuffle" boolean,
	"offline" boolean,
	"offline_timestamp" bigint,
	"incognito" boolean,
	"platform" text,
	"country" text,
	"context_type" text,
	"context_uri" text,
	"api_raw_sha256" text,
	"api_raw_index" integer,
	"export_raw_sha256" text,
	"export_raw_index" integer,
	"api_dedupe_key" text,
	"export_dedupe_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "listening_sync_state" (
	"id" text PRIMARY KEY NOT NULL,
	"cursor_played_at" timestamp with time zone,
	"last_run_at" timestamp with time zone,
	"last_run_status" text,
	"last_error" text,
	"last_run_stats" jsonb,
	"last_success_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "listening_tracks" (
	"id" text PRIMARY KEY NOT NULL,
	"uri" text NOT NULL,
	"name" text NOT NULL,
	"duration_ms" integer,
	"album_id" text,
	"artist_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"artist_names" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"explicit" boolean,
	"popularity" integer,
	"isrc" text,
	"disc_number" integer,
	"track_number" integer,
	"is_local" boolean,
	"raw_sha256" text,
	"fetched_at" timestamp with time zone NOT NULL,
	"complete" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX "listening_imports_created_idx" ON "listening_imports" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "listening_plays_played_at_idx" ON "listening_plays" USING btree ("played_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "listening_plays_track_id_idx" ON "listening_plays" USING btree ("track_id");--> statement-breakpoint
CREATE UNIQUE INDEX "listening_plays_api_key_idx" ON "listening_plays" USING btree ("api_dedupe_key") WHERE "listening_plays"."api_dedupe_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "listening_plays_export_key_idx" ON "listening_plays" USING btree ("export_dedupe_key") WHERE "listening_plays"."export_dedupe_key" is not null;