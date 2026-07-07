CREATE TABLE "activities" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "activities_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name" text DEFAULT '' NOT NULL,
	"sport_type" text NOT NULL,
	"start_date_utc" timestamp with time zone NOT NULL,
	"local_date" text NOT NULL,
	"local_time" text NOT NULL,
	"utc_offset_min" integer DEFAULT 0 NOT NULL,
	"distance_m" double precision DEFAULT 0 NOT NULL,
	"moving_time_s" integer DEFAULT 0 NOT NULL,
	"elapsed_time_s" integer DEFAULT 0 NOT NULL,
	"elev_gain_m" double precision DEFAULT 0 NOT NULL,
	"avg_speed_ms" double precision DEFAULT 0 NOT NULL,
	"max_speed_ms" double precision DEFAULT 0 NOT NULL,
	"avg_hr" double precision,
	"max_hr" double precision,
	"avg_cadence" double precision,
	"avg_watts" double precision,
	"max_watts" double precision,
	"kilojoules" double precision,
	"description" text,
	"suffer_score" double precision,
	"gear" text,
	"polyline" text,
	"card_polyline" text,
	"bounds" jsonb,
	"trim_start_m" double precision DEFAULT 0 NOT NULL,
	"trim_end_m" double precision DEFAULT 0 NOT NULL,
	"fit_blob_url" text,
	"fit_blob_pathname" text,
	"fit_sha256" text,
	"file_type" text,
	"source" text DEFAULT 'upload' NOT NULL,
	"external_id" text,
	"dedupe_key" text NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activities_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "activity_photos" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "activity_photos_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"activity_id" bigint NOT NULL,
	"blob_url" text NOT NULL,
	"blob_pathname" text NOT NULL,
	"width" integer,
	"height" integer,
	"position" integer DEFAULT 0 NOT NULL,
	"caption" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activity_photos" ADD CONSTRAINT "activity_photos_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "activities_external_id_idx" ON "activities" USING btree ("external_id") WHERE "activities"."external_id" is not null;--> statement-breakpoint
CREATE INDEX "activities_local_date_idx" ON "activities" USING btree ("local_date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "activities_start_date_idx" ON "activities" USING btree ("start_date_utc" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "activity_photos_activity_idx" ON "activity_photos" USING btree ("activity_id","position");