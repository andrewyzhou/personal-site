import { NextResponse } from "next/server";
import { Redis } from "@upstash/redis";
import { getAllSubmissions, getLatestCommitSha, LeetCodeSubmission, StoredSubmissions } from "@/lib/leetcode";

export const dynamic = "force-dynamic";

const redis = new Redis({
  url: process.env.KV_REST_API_URL || "",
  token: process.env.KV_REST_API_TOKEN || "",
});

const CACHE_KEY = "leetcode_submissions";

async function syncSubmissions(stored: StoredSubmissions | null) {
  try {
    let submissions: LeetCodeSubmission[];

    if (stored && stored.submissions.length > 0) {
      // Incremental update: fetch commits since the most recent date
      const mostRecentDate = stored.submissions[0].date;
      const sinceDate = new Date(mostRecentDate + "T00:00:00Z");
      sinceDate.setDate(sinceDate.getDate() - 1);

      const newSubmissions = await getAllSubmissions(sinceDate.toISOString());

      // Merge, avoiding duplicates by SHA
      const existingShas = new Set(stored.submissions.map(s => s.sha));
      const uniqueNew = newSubmissions.filter(s => !existingShas.has(s.sha));
      submissions = [...uniqueNew, ...stored.submissions];
    } else {
      submissions = await getAllSubmissions();
    }

    // Sort by date descending
    submissions.sort((a, b) => b.date.localeCompare(a.date));

    const data: StoredSubmissions = {
      submissions,
      lastFetchedAt: Date.now(),
    };

    await redis.set(CACHE_KEY, data);
    return data;
  } catch (error) {
    console.error("Error syncing leetcode submissions:", error);
    return stored;
  }
}

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
    console.error("Error fetching stored leetcode submissions:", error);
    return NextResponse.json({ submissions: [], lastFetchedAt: null }, { status: 500 });
  }
}

// POST: Force sync submissions from GitHub
export async function POST() {
  try {
    const stored = await redis.get<StoredSubmissions>(CACHE_KEY);
    const data = await syncSubmissions(stored);

    return NextResponse.json({
      success: true,
      count: data?.submissions.length ?? 0,
      lastFetchedAt: data?.lastFetchedAt,
    });
  } catch (error) {
    console.error("Error syncing leetcode submissions:", error);
    return NextResponse.json({ success: false, error: "Failed to sync" }, { status: 500 });
  }
}
