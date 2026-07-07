// shared leetcode submission sync (extracted from the api route so the cms
// commit flow can refresh the public store after pushing a solution).

import { Redis } from "@upstash/redis";
import { getAllSubmissions, type LeetCodeSubmission, type StoredSubmissions } from "./leetcode";
import { log } from "./log";

const redis = new Redis({
  url: process.env.KV_REST_API_URL || "",
  token: process.env.KV_REST_API_TOKEN || "",
});

export const LEETCODE_CACHE_KEY = "leetcode_submissions";

export async function syncSubmissions(stored: StoredSubmissions | null): Promise<StoredSubmissions | null> {
  try {
    let submissions: LeetCodeSubmission[];

    if (stored && stored.submissions.length > 0) {
      // incremental update: fetch commits since the most recent date
      const mostRecentDate = stored.submissions[0].date;
      const sinceDate = new Date(mostRecentDate + "T00:00:00Z");
      sinceDate.setDate(sinceDate.getDate() - 1);

      const newSubmissions = await getAllSubmissions(sinceDate.toISOString());

      // merge, avoiding duplicates by sha
      const existingShas = new Set(stored.submissions.map((s) => s.sha));
      const uniqueNew = newSubmissions.filter((s) => !existingShas.has(s.sha));
      submissions = [...uniqueNew, ...stored.submissions];
    } else {
      submissions = await getAllSubmissions();
    }

    // sort by date descending
    submissions.sort((a, b) => b.date.localeCompare(a.date));

    const data: StoredSubmissions = {
      submissions,
      lastFetchedAt: Date.now(),
    };

    await redis.set(LEETCODE_CACHE_KEY, data);
    return data;
  } catch (error) {
    log.error("leetcode-sync", "sync failed, keeping existing data", error);
    return stored;
  }
}

export async function readStoredSubmissions(): Promise<StoredSubmissions | null> {
  try {
    return await redis.get<StoredSubmissions>(LEETCODE_CACHE_KEY);
  } catch (error) {
    log.error("leetcode-sync", "redis read failed", error);
    return null;
  }
}
