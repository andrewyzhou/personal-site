// leetcode url → { number, title, difficulty } via the unofficial graphql api.
// every gate from docs/research/leetcode-graphql.md; failures never cached and
// never block manual entry.

import { Redis } from "@upstash/redis";
import { log } from "@/lib/log";

const redis = new Redis({
  url: process.env.KV_REST_API_URL || "",
  token: process.env.KV_REST_API_TOKEN || "",
});

export interface LeetCodeLookup {
  number: number;
  title: string;
  difficulty: "Easy" | "Medium" | "Hard";
}

export type LookupResult =
  | { ok: true; data: LeetCodeLookup }
  | { ok: false; code: "validation" | "not_found" | "rate_limited" | "lookup_failed"; message: string };

const URL_RE = /^https:\/\/leetcode\.com\/problems\/([a-z0-9-]+)(?:\/.*)?$/;

export function slugFromUrl(url: string): string | null {
  const m = url.trim().match(URL_RE);
  return m ? m[1] : null;
}

const QUERY =
  "query q($slug: String!) { question(titleSlug: $slug) { questionFrontendId title titleSlug difficulty isPaidOnly } }";

export async function lookupProblem(url: string): Promise<LookupResult> {
  // gate 1: url shape (leetcode.cn and garbage rejected)
  const slug = slugFromUrl(url);
  if (!slug) {
    return { ok: false, code: "validation", message: "paste a leetcode.com/problems/... url" };
  }

  // gate 2: cache (successes only, metadata is immutable)
  try {
    const cached = await redis.get<LeetCodeLookup>(`lc:q:${slug}`);
    if (cached) return { ok: true, data: cached };
  } catch {
    // cache miss path
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    let res: Response;
    try {
      res = await fetch("https://leetcode.com/graphql", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: QUERY, variables: { slug } }),
        signal: AbortSignal.timeout(8000),
      });
    } catch (error) {
      log.warn("leetcode:lookup", `network/timeout for ${slug}`, error);
      return { ok: false, code: "lookup_failed", message: "leetcode lookup unavailable — fill fields manually" };
    }

    // gate 4a: 429 → one retry after 1s
    if (res.status === 429) {
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
      return { ok: false, code: "rate_limited", message: "leetcode is rate limiting — try again later" };
    }

    // gate 4b: cloudflare block returns html instead of json
    const contentType = res.headers.get("content-type") ?? "";
    if (!res.ok || !contentType.includes("application/json")) {
      log.warn("leetcode:lookup", `blocked/failed for ${slug}: ${res.status} ${contentType}`);
      return { ok: false, code: "lookup_failed", message: "leetcode lookup unavailable — fill fields manually" };
    }

    const body = await res.json().catch(() => null);
    const q = body?.data?.question;

    // gate 5: unknown slug returns 200 with null question
    if (!q) {
      return { ok: false, code: "not_found", message: "problem not found — check the url" };
    }

    // gate 6: schema drift treated as outage
    const number = Number(q.questionFrontendId);
    const title = typeof q.title === "string" ? q.title.trim() : "";
    const difficulty = q.difficulty;
    if (!Number.isInteger(number) || number < 1 || !title || !["Easy", "Medium", "Hard"].includes(difficulty)) {
      log.warn("leetcode:lookup", `schema drift for ${slug}: ${JSON.stringify(q).slice(0, 120)}`);
      return { ok: false, code: "lookup_failed", message: "leetcode lookup unavailable — fill fields manually" };
    }

    const data: LeetCodeLookup = { number, title, difficulty };
    try {
      await redis.set(`lc:q:${slug}`, data, { ex: 30 * 24 * 3600 });
    } catch {
      // cache only
    }
    return { ok: true, data };
  }

  return { ok: false, code: "lookup_failed", message: "leetcode lookup unavailable — fill fields manually" };
}
