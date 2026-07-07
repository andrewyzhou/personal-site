import { requireAdmin } from "@/lib/admin-auth";
import { ok, fail } from "@/lib/admin/api-envelope";
import { lookupProblem } from "@/lib/admin/leetcode-lookup";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STATUS: Record<string, number> = {
  validation: 400,
  not_found: 404,
  rate_limited: 429,
  lookup_failed: 502,
};

export async function GET(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const url = new URL(request.url).searchParams.get("url") ?? "";
  const result = await lookupProblem(url);
  if (result.ok) return ok(result.data);
  return fail(result.code, result.message, STATUS[result.code] ?? 502);
}
