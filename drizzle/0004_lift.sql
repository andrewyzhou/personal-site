CREATE TABLE "exercise_aliases" (
	"exercise_id" text NOT NULL,
	"alias" text NOT NULL,
	"normalized" text NOT NULL,
	CONSTRAINT "exercise_aliases_exercise_id_normalized_pk" PRIMARY KEY("exercise_id","normalized")
);
--> statement-breakpoint
CREATE TABLE "exercise_muscles" (
	"exercise_id" text NOT NULL,
	"region" text NOT NULL,
	"role" text NOT NULL,
	CONSTRAINT "exercise_muscles_exercise_id_region_pk" PRIMARY KEY("exercise_id","region")
);
--> statement-breakpoint
CREATE TABLE "exercises" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"equipment" text DEFAULT 'other' NOT NULL,
	"category" text DEFAULT 'strength' NOT NULL,
	"tracking" text DEFAULT 'weight_reps' NOT NULL,
	"source" text NOT NULL,
	"is_custom" boolean DEFAULT false NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"free_db_id" text,
	"merged_into" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lift_ingests" (
	"id" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"raw_sha256" text NOT NULL,
	"raw_text" text NOT NULL,
	"raw_object_id" text,
	"strong_slug" text,
	"workout_id" text,
	"status" text NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lift_ingests_raw_sha256_unique" UNIQUE("raw_sha256")
);
--> statement-breakpoint
CREATE TABLE "lift_sets" (
	"id" text PRIMARY KEY NOT NULL,
	"workout_exercise_id" text NOT NULL,
	"position" integer NOT NULL,
	"kind" text NOT NULL,
	"weight" double precision,
	"unit" text,
	"weight_kg" double precision,
	"reps" integer,
	"duration_s" integer,
	"distance_m" double precision,
	"rpe" double precision,
	"bodyweight" boolean DEFAULT false NOT NULL,
	"note" text,
	"e1rm_kg" double precision,
	"completed" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lift_template_exercises" (
	"id" text PRIMARY KEY NOT NULL,
	"template_id" text NOT NULL,
	"exercise_id" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"planned_sets" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "lift_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"folder" text,
	"notes" text,
	"position" integer DEFAULT 0 NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lift_workout_activities" (
	"workout_id" text NOT NULL,
	"activity_id" bigint NOT NULL,
	"role" text NOT NULL,
	"method" text NOT NULL,
	"delta_min" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lift_workout_activities_workout_id_activity_id_pk" PRIMARY KEY("workout_id","activity_id")
);
--> statement-breakpoint
CREATE TABLE "lift_workout_exercises" (
	"id" text PRIMARY KEY NOT NULL,
	"workout_id" text NOT NULL,
	"exercise_id" text NOT NULL,
	"position" integer NOT NULL,
	"name_raw" text NOT NULL,
	"notes" text,
	"superset_group" integer
);
--> statement-breakpoint
CREATE TABLE "lift_workouts" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"started_local" text NOT NULL,
	"started_at" timestamp with time zone,
	"utc_offset_min" integer,
	"ended_at" timestamp with time zone,
	"duration_s" integer,
	"notes" text,
	"source" text NOT NULL,
	"latest_ingest_id" text,
	"strong_slug" text,
	"working_sets" integer DEFAULT 0 NOT NULL,
	"volume_kg" double precision DEFAULT 0 NOT NULL,
	"muscle_load" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "exercise_aliases" ADD CONSTRAINT "exercise_aliases_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_muscles" ADD CONSTRAINT "exercise_muscles_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lift_sets" ADD CONSTRAINT "lift_sets_workout_exercise_id_lift_workout_exercises_id_fk" FOREIGN KEY ("workout_exercise_id") REFERENCES "public"."lift_workout_exercises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lift_template_exercises" ADD CONSTRAINT "lift_template_exercises_template_id_lift_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."lift_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lift_template_exercises" ADD CONSTRAINT "lift_template_exercises_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lift_workout_activities" ADD CONSTRAINT "lift_workout_activities_workout_id_lift_workouts_id_fk" FOREIGN KEY ("workout_id") REFERENCES "public"."lift_workouts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lift_workout_activities" ADD CONSTRAINT "lift_workout_activities_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lift_workout_exercises" ADD CONSTRAINT "lift_workout_exercises_workout_id_lift_workouts_id_fk" FOREIGN KEY ("workout_id") REFERENCES "public"."lift_workouts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lift_workout_exercises" ADD CONSTRAINT "lift_workout_exercises_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "exercise_aliases_normalized_idx" ON "exercise_aliases" USING btree ("normalized");--> statement-breakpoint
CREATE INDEX "lift_ingests_strong_slug_idx" ON "lift_ingests" USING btree ("strong_slug");--> statement-breakpoint
CREATE INDEX "lift_sets_workout_exercise_idx" ON "lift_sets" USING btree ("workout_exercise_id","position");--> statement-breakpoint
CREATE INDEX "lift_template_exercises_template_idx" ON "lift_template_exercises" USING btree ("template_id","position");--> statement-breakpoint
CREATE INDEX "lift_workout_activities_activity_idx" ON "lift_workout_activities" USING btree ("activity_id");--> statement-breakpoint
CREATE INDEX "lift_workout_exercises_workout_idx" ON "lift_workout_exercises" USING btree ("workout_id","position");--> statement-breakpoint
CREATE INDEX "lift_workout_exercises_exercise_idx" ON "lift_workout_exercises" USING btree ("exercise_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lift_workouts_strong_slug_idx" ON "lift_workouts" USING btree ("strong_slug") WHERE "lift_workouts"."strong_slug" is not null;--> statement-breakpoint
CREATE INDEX "lift_workouts_started_local_idx" ON "lift_workouts" USING btree ("started_local" DESC NULLS LAST);