CREATE TABLE "privacy_settings" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "privacy_settings_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"settings" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "map_hidden" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "hr_hidden" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "published_local_time" text;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "published_start_utc" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "fog_events" jsonb;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "fog_shapes" jsonb;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "track_bbox" jsonb;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "needs_republish" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "stale_marked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "legacy_route" jsonb;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "republish_attempted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "activity_photos" ADD COLUMN "taken_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "activity_photos" ADD COLUMN "gps_lat" double precision;--> statement-breakpoint
ALTER TABLE "activity_photos" ADD COLUMN "gps_lng" double precision;--> statement-breakpoint
ALTER TABLE "activity_photos" ADD COLUMN "pin_lat" double precision;--> statement-breakpoint
ALTER TABLE "activity_photos" ADD COLUMN "pin_lng" double precision;--> statement-breakpoint
ALTER TABLE "privacy_zones" ADD COLUMN "replaces_id" bigint;--> statement-breakpoint
ALTER TABLE "privacy_zones" ADD COLUMN "archived_at" timestamp with time zone;