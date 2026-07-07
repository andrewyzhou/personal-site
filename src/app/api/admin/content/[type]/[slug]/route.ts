import { requireAdmin } from "@/lib/admin-auth";
import { ok, fail, mapError } from "@/lib/admin/api-envelope";
import { getContentType, readEntry, updateEntry, deleteEntry } from "@/lib/admin/content-store";
import { GitHubExistsError } from "@/lib/admin/github-content";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ type: string; slug: string }> };

export async function GET(request: Request, { params }: Params) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const { type, slug } = await params;
  const t = getContentType(type);
  if (!t) return fail("not_found", "unknown content type", 404);

  try {
    const entry = await readEntry(t, slug);
    return ok(entry);
  } catch (error) {
    return mapError(error);
  }
}

export async function PUT(request: Request, { params }: Params) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const { type, slug } = await params;
  const t = getContentType(type);
  if (!t) return fail("not_found", "unknown content type", 404);

  let body: { frontmatter?: Record<string, unknown>; body?: string; baseSha?: string };
  try {
    body = await request.json();
  } catch {
    return fail("validation", "invalid json body", 400);
  }
  if (!body.baseSha) return fail("validation", "baseSha is required", 400);

  const frontmatter = body.frontmatter ?? {};
  const errors = t.validate(frontmatter, body.body ?? "");
  if (errors.length > 0) return fail("validation", errors.join("; "), 400);

  try {
    const current = await readEntry(t, slug);
    try {
      const result = await updateEntry(t, current.path, slug, frontmatter, body.body ?? "", body.baseSha);
      return ok({ sha: result.blobSha, commitSha: result.commitSha, commitUrl: result.commitUrl });
    } catch (error) {
      if (error instanceof GitHubExistsError) {
        // stale sha: re-fetch remote so the ui can offer reload/overwrite
        log.warn("admin:content", `conflict on ${current.path} base=${body.baseSha.slice(0, 7)}`);
        const remote = await readEntry(t, slug);
        return fail("conflict", "this file changed on github since you opened it", 409, {
          remoteSha: remote.sha,
          remoteFrontmatter: remote.frontmatter,
          remoteBody: remote.body,
        });
      }
      throw error;
    }
  } catch (error) {
    return mapError(error);
  }
}

export async function DELETE(request: Request, { params }: Params) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const { type, slug } = await params;
  const t = getContentType(type);
  if (!t) return fail("not_found", "unknown content type", 404);
  if (t.singleton) return fail("validation", "singletons cannot be deleted", 400);

  const sha = new URL(request.url).searchParams.get("sha");
  if (!sha) return fail("validation", "sha query param is required", 400);

  try {
    const entry = await readEntry(t, slug);
    if (entry.sha !== sha) {
      return fail("conflict", "this file changed on github since you opened it", 409);
    }
    const result = await deleteEntry(t, entry.path, slug, sha);
    return ok(result);
  } catch (error) {
    return mapError(error);
  }
}
