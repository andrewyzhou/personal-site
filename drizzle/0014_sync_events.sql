CREATE TABLE "sync_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sync_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"run_id" text NOT NULL,
	"trigger" text NOT NULL,
	"source" text NOT NULL,
	"kind" text NOT NULL,
	"activity_id" bigint,
	"external_id" text,
	"detail" jsonb,
	"duration_ms" integer
);
--> statement-breakpoint
CREATE INDEX "sync_events_at_idx" ON "sync_events" USING btree ("at");--> statement-breakpoint
CREATE INDEX "sync_events_run_idx" ON "sync_events" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "sync_events_activity_idx" ON "sync_events" USING btree ("activity_id");
