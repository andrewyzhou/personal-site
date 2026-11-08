DROP TABLE "activity_settings" CASCADE;--> statement-breakpoint
DROP TABLE "comments" CASCADE;--> statement-breakpoint
DROP TABLE "likes" CASCADE;--> statement-breakpoint
DROP TABLE "lift_bodyweights" CASCADE;--> statement-breakpoint
DROP TABLE "lift_programs" CASCADE;--> statement-breakpoint
DROP TABLE "lift_sync_log" CASCADE;--> statement-breakpoint
DROP TABLE "lift_template_exercises" CASCADE;--> statement-breakpoint
DROP TABLE "lift_template_folders" CASCADE;--> statement-breakpoint
DROP TABLE "lift_templates" CASCADE;--> statement-breakpoint
ALTER TABLE "exercises" DROP COLUMN "archived";--> statement-breakpoint
ALTER TABLE "lift_workouts" DROP COLUMN "template_id";