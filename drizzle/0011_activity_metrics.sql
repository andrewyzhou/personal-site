CREATE TABLE "activity_metrics" (
	"activity_id" bigint PRIMARY KEY NOT NULL,
	"data" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activity_metrics" ADD CONSTRAINT "activity_metrics_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE cascade ON UPDATE no action;