import { Redis } from "@upstash/redis";
import { requireAdmin } from "@/lib/admin-auth";
import { ok } from "@/lib/admin/api-envelope";
import { getDeploymentState, type DeployState } from "@/lib/admin/github-content";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const redis = new Redis({
  url: process.env.KV_REST_API_URL || "",
  token: process.env.KV_REST_API_TOKEN || "",
});

// vercel's github integration writes deployment statuses — polled here for the
// post-commit "rebuilding" chip. this endpoint never errors: unknown is a state.
export async function GET(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const sha = new URL(request.url).searchParams.get("sha") ?? "";
  if (!/^[0-9a-f]{7,40}$/i.test(sha)) {
    return ok({ state: "unknown", targetUrl: null });
  }

  const memoKey = `cms:deploy:${sha}`;
  try {
    const memo = await redis.get<DeployState & { checkedAt: number }>(memoKey);
    if (memo && Date.now() - memo.checkedAt < 10_000) {
      return ok({ state: memo.state, targetUrl: memo.targetUrl });
    }
  } catch {
    // memo is best-effort
  }

  const state = await getDeploymentState(sha);
  try {
    await redis.set(memoKey, { ...state, checkedAt: Date.now() }, { ex: 3600 });
  } catch {
    // memo is best-effort
  }
  return ok(state);
}
