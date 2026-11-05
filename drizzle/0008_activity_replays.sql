CREATE TABLE "activity_replays" (
	"activity_id" bigint PRIMARY KEY NOT NULL,
	"data" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activity_replays" ADD CONSTRAINT "activity_replays_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE cascade ON UPDATE no action;