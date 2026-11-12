CREATE TABLE "content_drafts" (
	"type" text NOT NULL,
	"slug" text NOT NULL,
	"frontmatter" jsonb NOT NULL,
	"body" text NOT NULL,
	"sha" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_drafts_type_slug_pk" PRIMARY KEY("type","slug")
);
