import { NextResponse } from "next/server";
import { Redis } from "@upstash/redis";
import { getLatestCommitSha, StoredSubmissions } from "@/lib/leetcode";
import { syncSubmissions, LEETCODE_CACHE_KEY as CACHE_KEY } from "@/lib/leetcode-sync";
import { isAdminRequest, unauthorizedResponse } from "@/lib/admin-auth";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";

const redis = new Redis({
  url: process.env.KV_REST_API_URL || "",
  token: process.env.KV_REST_API_TOKEN || "",
});

// GET: Return cached submissions, auto-sync if new commits detected
export async function GET() {
  try {
    const stored = await redis.get<StoredSubmissions>(CACHE_KEY);

    // Check if latest commit differs from cache (like Strava pattern)
    const latestSha = await getLatestCommitSha();
    const cachedLatestSha = stored?.submissions?.[0]?.sha ?? null;

    if (latestSha && latestSha !== cachedLatestSha) {
      const updated = await syncSubmissions(stored);
      return NextResponse.json(updated || { submissions: [], lastFetchedAt: null });
    }

    return NextResponse.json(stored || { submissions: [], lastFetchedAt: null });
  } catch (error) {
    log.error("api:github/leetcode", "failed to read stored submissions", error);
    return NextResponse.json({ submissions: [], lastFetchedAt: null }, { status: 500 });
  }
}

// POST: admin-only force sync from GitHub
export async function POST(request: Request) {
  if (!(await isAdminRequest(request))) {
    return unauthorizedResponse();
  }

  try {
    const stored = await redis.get<StoredSubmissions>(CACHE_KEY);
    const data = await syncSubmissions(stored);

    return NextResponse.json({
      success: true,
      count: data?.submissions.length ?? 0,
      lastFetchedAt: data?.lastFetchedAt,
    });
  } catch (error) {
    log.error("api:github/leetcode", "force sync failed", error);
    return NextResponse.json({ success: false, error: "Failed to sync" }, { status: 500 });
  }
}
