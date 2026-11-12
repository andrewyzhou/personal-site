import { pgTable, text, timestamp, jsonb, primaryKey } from "drizzle-orm/pg-core";

// unpublished content. a draft lives here, never in the repo, until it is
// published; publishing writes the file to the repo and removes the row.
// `sha` is the hash of the serialized entry, used to refuse a save made
// from a stale copy.
export const contentDrafts = pgTable(
  "content_drafts",
  {
    type: text("type").notNull(),
    slug: text("slug").notNull(),
    frontmatter: jsonb("frontmatter").$type<Record<string, unknown>>().notNull(),
    body: text("body").notNull(),
    sha: text("sha").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.type, t.slug] })]
);
