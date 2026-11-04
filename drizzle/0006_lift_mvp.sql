CREATE TABLE "lift_bodyweights" (
	"id" text PRIMARY KEY NOT NULL,
	"measured_at" timestamp with time zone NOT NULL,
	"weight" double precision NOT NULL,
	"unit" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lift_sync_log" (
	"device_id" text NOT NULL,
	"seq" bigint NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text NOT NULL,
	"op" text NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rejected" text,
	CONSTRAINT "lift_sync_log_device_id_seq_pk" PRIMARY KEY("device_id","seq")
);
--> statement-breakpoint
CREATE TABLE "lift_template_folders" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lift_sets" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "lift_sets" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "lift_template_exercises" ADD COLUMN "superset_group" integer;--> statement-breakpoint
ALTER TABLE "lift_template_exercises" ADD COLUMN "rest_s" integer;--> statement-breakpoint
ALTER TABLE "lift_template_exercises" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "lift_template_exercises" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "lift_templates" ADD COLUMN "folder_id" text;--> statement-breakpoint
ALTER TABLE "lift_workout_exercises" ADD COLUMN "rest_s" integer;--> statement-breakpoint
ALTER TABLE "lift_workout_exercises" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "lift_workout_exercises" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "lift_workouts" ADD COLUMN "status" text DEFAULT 'finished' NOT NULL;--> statement-breakpoint
ALTER TABLE "lift_workouts" ADD COLUMN "template_id" text;--> statement-breakpoint
CREATE INDEX "lift_bodyweights_measured_at_idx" ON "lift_bodyweights" USING btree ("measured_at");--> statement-breakpoint
ALTER TABLE "lift_templates" ADD CONSTRAINT "lift_templates_folder_id_lift_template_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."lift_template_folders"("id") ON DELETE set null ON UPDATE no action;