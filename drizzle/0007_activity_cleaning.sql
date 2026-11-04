CREATE TABLE "activity_settings" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "activity_settings_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"settings" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activity_suggestions" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "activity_suggestions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"activity_id" bigint NOT NULL,
	"detector_version" integer NOT NULL,
	"fingerprint" text NOT NULL,
	"kind" text NOT NULL,
	"confidence" double precision NOT NULL,
	"edit" jsonb,
	"summary" text NOT NULL,
	"range" jsonb,
	"status" text DEFAULT 'open' NOT NULL,
	"edit_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "raw_stats" jsonb;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "hr_zones_s" jsonb;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "split_from_id" bigint;--> statement-breakpoint
ALTER TABLE "activity_suggestions" ADD CONSTRAINT "activity_suggestions_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "activity_suggestions_fp_idx" ON "activity_suggestions" USING btree ("activity_id","detector_version","fingerprint");--> statement-breakpoint
CREATE INDEX "activity_suggestions_activity_idx" ON "activity_suggestions" USING btree ("activity_id","status");