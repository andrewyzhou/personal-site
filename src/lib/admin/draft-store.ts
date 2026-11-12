// drafts for the cms. kept in the database so unpublished writing is never
// in the repo. every write is a single statement guarded by the row's sha.

import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb, contentDrafts } from "@/lib/db";

export interface Draft {
  type: string;
  slug: string;
  frontmatter: Record<string, unknown>;
  body: string;
  sha: string;
}

// where a draft "lives", for the places that expect a file path
export const draftPath = (type: string, slug: string) => `draft:${type}/${slug}`;
export const isDraftPath = (path: string) => path.startsWith("draft:");

// hash of the entry exactly as it would be written to a file
export function draftSha(serialized: string): string {
  return createHash("sha1").update(serialized).digest("hex");
}

const pick = (r: typeof contentDrafts.$inferSelect): Draft => ({ type: r.type, slug: r.slug, frontmatter: r.frontmatter, body: r.body, sha: r.sha });

export async function listDrafts(type: string): Promise<Draft[]> {
  const rows = await getDb().select().from(contentDrafts).where(eq(contentDrafts.type, type));
  return rows.map(pick).sort((a, b) => a.slug.localeCompare(b.slug));
}

export async function getDraft(type: string, slug: string): Promise<Draft | null> {
  const rows = await getDb()
    .select()
    .from(contentDrafts)
    .where(and(eq(contentDrafts.type, type), eq(contentDrafts.slug, slug)))
    .limit(1);
  return rows[0] ? pick(rows[0]) : null;
}

// false when a draft with this type and slug already exists
export async function insertDraft(d: Draft): Promise<boolean> {
  const rows = await getDb().insert(contentDrafts).values(d).onConflictDoNothing().returning({ slug: contentDrafts.slug });
  return rows.length > 0;
}

// false when the stored draft is no longer the one `baseSha` was read from
export async function updateDraft(d: Draft, baseSha: string): Promise<boolean> {
  const rows = await getDb()
    .update(contentDrafts)
    .set({ frontmatter: d.frontmatter, body: d.body, sha: d.sha, updatedAt: new Date() })
    .where(and(eq(contentDrafts.type, d.type), eq(contentDrafts.slug, d.slug), eq(contentDrafts.sha, baseSha)))
    .returning({ slug: contentDrafts.slug });
  return rows.length > 0;
}

// false when nothing matched (already gone, or changed since `sha`)
export async function deleteDraft(type: string, slug: string, sha: string): Promise<boolean> {
  const rows = await getDb()
    .delete(contentDrafts)
    .where(and(eq(contentDrafts.type, type), eq(contentDrafts.slug, slug), eq(contentDrafts.sha, sha)))
    .returning({ slug: contentDrafts.slug });
  return rows.length > 0;
}
