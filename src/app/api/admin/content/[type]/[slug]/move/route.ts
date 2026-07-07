import { requireAdmin } from "@/lib/admin-auth";
import { ok, fail, mapError } from "@/lib/admin/api-envelope";
import { getContentType, readEntry, moveEntry } from "@/lib/admin/content-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST: publish (wip → live) or unpublish (live → wip) as one atomic commit
export async function POST(request: Request, { params }: { params: Promise<{ type: string; slug: string }> }) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const { type, slug } = await params;
  const t = getContentType(type);
  if (!t) return fail("not_found", "unknown content type", 404);
  if (!t.hasWip) return fail("validation", "this type has no draft convention", 400);

  let body: { direction?: string; baseSha?: string };
  try {
    body = await request.json();
  } catch {
    return fail("validation", "invalid json body", 400);
  }
  if (body.direction !== "publish" && body.direction !== "unpublish") {
    return fail("validation", "direction must be publish or unpublish", 400);
  }
  if (!body.baseSha) return fail("validation", "baseSha is required", 400);

  try {
    const entry = await readEntry(t, slug);
    const expectedStatus = body.direction === "publish" ? "wip" : "published";
    if (entry.status !== expectedStatus) {
      return fail("validation", `entry is not ${expectedStatus}`, 400);
    }
    if (entry.sha !== body.baseSha) {
      return fail("conflict", "this file changed on github since you opened it", 409);
    }
    const result = await moveEntry(t, slug, body.direction, entry.sha);
    return ok(result);
  } catch (error) {
    return mapError(error);
  }
}
