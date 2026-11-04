CREATE TABLE "activity_edits" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "activity_edits_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"activity_id" bigint NOT NULL,
	"kind" text NOT NULL,
	"params" jsonb NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reverted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "activity_sources" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "activity_sources_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"activity_id" bigint NOT NULL,
	"provider" text NOT NULL,
	"external_id" text,
	"kind" text NOT NULL,
	"raw_sha256" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activity_sources_identity_uq" UNIQUE NULLS NOT DISTINCT("activity_id","provider","external_id","kind","raw_sha256")
);
--> statement-breakpoint
CREATE TABLE "privacy_zones" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "privacy_zones_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name" text DEFAULT '' NOT NULL,
	"polygon" jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "raw_objects" (
	"sha256" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"content_type" text NOT NULL,
	"kind" text NOT NULL,
	"original_filename" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "raw_objects_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "processing_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "published_inputs_hash" text;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "canonical_track_key" text;--> statement-breakpoint
ALTER TABLE "activity_photos" ADD COLUMN "original_sha256" text;--> statement-breakpoint
ALTER TABLE "activity_edits" ADD CONSTRAINT "activity_edits_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_sources" ADD CONSTRAINT "activity_sources_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_edits_activity_idx" ON "activity_edits" USING btree ("activity_id","id");--> statement-breakpoint
CREATE INDEX "activity_sources_activity_idx" ON "activity_sources" USING btree ("activity_id");--> statement-breakpoint
CREATE INDEX "activity_sources_external_idx" ON "activity_sources" USING btree ("provider","external_id");--> statement-breakpoint
CREATE INDEX "activity_sources_raw_idx" ON "activity_sources" USING btree ("raw_sha256");--> statement-breakpoint
CREATE INDEX "raw_objects_kind_idx" ON "raw_objects" USING btree ("kind");