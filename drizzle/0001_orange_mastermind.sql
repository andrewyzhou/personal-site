CREATE TABLE "comments" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "comments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"target_type" text NOT NULL,
	"target_slug" text NOT NULL,
	"author_name" text NOT NULL,
	"author_email" text,
	"is_guest" boolean DEFAULT true NOT NULL,
	"body" text NOT NULL,
	"ip_hash" text,
	"hidden" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "counters" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "counters_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"target_type" text NOT NULL,
	"target_slug" text NOT NULL,
	"kind" text NOT NULL,
	"count" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "likes" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "likes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"target_type" text NOT NULL,
	"target_slug" text NOT NULL,
	"user_email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "comments_target_idx" ON "comments" USING btree ("target_type","target_slug","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "counters_unique_idx" ON "counters" USING btree ("target_type","target_slug","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "likes_unique_idx" ON "likes" USING btree ("target_type","target_slug","user_email");