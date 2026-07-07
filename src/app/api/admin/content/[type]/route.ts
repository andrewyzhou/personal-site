import { requireAdmin } from "@/lib/admin-auth";
import { ok, fail, mapError } from "@/lib/admin/api-envelope";
import { getContentType, listEntries, createEntry, validateSlug, readEntry } from "@/lib/admin/content-store";
import { GitHubNotFoundError } from "@/lib/admin/github-content";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET: list entries for a collection type
export async function GET(request: Request, { params }: { params: Promise<{ type: string }> }) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const { type } = await params;
  const t = getContentType(type);
  if (!t) return fail("not_found", "unknown content type", 404);
  if (t.singleton) return fail("validation", "singletons have no list — read them directly", 400);

  try {
    const { items, stale } = await listEntries(t);
    return ok(items, 200, stale ? { stale: true } : undefined);
  } catch (error) {
    return mapError(error);
  }
}

// POST: create a new entry
export async function POST(request: Request, { params }: { params: Promise<{ type: string }> }) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const { type } = await params;
  const t = getContentType(type);
  if (!t) return fail("not_found", "unknown content type", 404);
  if (t.singleton) return fail("validation", "singletons cannot be created", 400);

  let body: { slug?: string; frontmatter?: Record<string, unknown>; body?: string; wip?: boolean };
  try {
    body = await request.json();
  } catch {
    return fail("validation", "invalid json body", 400);
  }

  const slug = (body.slug ?? "").trim();
  const slugError = validateSlug(t, slug) ?? (slug ? null : "slug is required");
  if (slugError) return fail("validation", slugError, 400);

  const frontmatter = body.frontmatter ?? {};
  const errors = t.validate(frontmatter, body.body ?? "");
  if (errors.length > 0) return fail("validation", errors.join("; "), 400);

  try {
    // reject a slug that exists in either published or wip
    try {
      await readEntry(t, slug);
      return fail("exists", "an entry with this slug already exists", 409);
    } catch (error) {
      if (!(error instanceof GitHubNotFoundError)) throw error;
    }

    const result = await createEntry(t, slug, frontmatter, body.body ?? "", body.wip ?? t.hasWip);
    return ok({ path: result.path, sha: result.blobSha, commitSha: result.commitSha, commitUrl: result.commitUrl }, 201);
  } catch (error) {
    return mapError(error);
  }
}
