// engagement plumbing: target validation, ip hashing, redis fixed-window rate
// limiting, and the comment filter chain (word blocklist, link cap, lengths,
// honeypot, dedupe). simple filtering by design — no llm, no approval queue.

import { createHash } from "crypto";
import { Redis } from "@upstash/redis";
import { and, eq, gte } from "drizzle-orm";
import { getDb, comments } from "./db";
import { log } from "./log";

const redis = new Redis({
  url: process.env.KV_REST_API_URL || "",
  token: process.env.KV_REST_API_TOKEN || "",
});

export const TARGET_TYPES = ["blog", "photos", "activity"] as const;
export type TargetType = (typeof TARGET_TYPES)[number];

export function parseTarget(raw: string | null): { type: TargetType; slug: string } | null {
  if (!raw) return null;
  const [type, ...rest] = raw.split(":");
  const slug = rest.join(":");
  if (!TARGET_TYPES.includes(type as TargetType)) return null;
  if (!/^[a-z0-9][a-z0-9-_]*$/.test(slug)) return null;
  return { type: type as TargetType, slug };
}

export function ipHashFromRequest(request: Request): string {
  const salt = process.env.IP_HASH_SALT ?? "";
  const forwarded = request.headers.get("x-forwarded-for") ?? "";
  const ip = forwarded.split(",")[0].trim() || "unknown";
  return createHash("sha256").update(`${ip}:${salt}`).digest("hex").slice(0, 32);
}

// fixed-window rate limit on redis: allow `limit` events per `windowS` seconds.
// fails open — engagement must never take the site down with it.
export async function rateLimit(bucket: string, key: string, limit: number, windowS: number): Promise<boolean> {
  try {
    const redisKey = `rl:${bucket}:${key}`;
    const count = await redis.incr(redisKey);
    if (count === 1) {
      await redis.expire(redisKey, windowS);
    }
    return count <= limit;
  } catch (error) {
    log.warn("engagement", "rate limiter unavailable, allowing", error);
    return true;
  }
}

// small blocklist for obvious junk; post-hoc moderation handles the rest
const BLOCKED_WORDS = [
  "viagra", "cialis", "casino", "porn", "xxx", "crypto giveaway", "airdrop",
  "onlyfans", "escort", "loan approval", "work from home", "earn $$",
];

const MAX_BODY = 2000;
const MIN_BODY = 2;
const MAX_NAME = 40;
const MAX_LINKS = 1;

export interface CommentInput {
  body: string;
  authorName: string;
  honeypot: string; // must be empty — bots fill every field
}

export function filterComment(input: CommentInput): string | null {
  if (input.honeypot.trim() !== "") return "rejected"; // silent bot trap
  const body = input.body.trim();
  if (body.length < MIN_BODY) return "comment is too short";
  if (body.length > MAX_BODY) return `comment is too long (max ${MAX_BODY} characters)`;
  if (input.authorName.trim().length > MAX_NAME) return "name is too long";
  const lower = body.toLowerCase();
  if (BLOCKED_WORDS.some((w) => lower.includes(w))) return "comment contains blocked words";
  const links = (body.match(/https?:\/\//g) ?? []).length;
  if (links > MAX_LINKS) return `max ${MAX_LINKS} link per comment`;
  return null;
}

// same body on the same target within 10 minutes = double-post / spam
export async function isDuplicateComment(
  targetType: string,
  targetSlug: string,
  body: string
): Promise<boolean> {
  const since = new Date(Date.now() - 10 * 60 * 1000);
  const recent = await getDb()
    .select({ body: comments.body })
    .from(comments)
    .where(and(eq(comments.targetType, targetType), eq(comments.targetSlug, targetSlug), gte(comments.createdAt, since)));
  return recent.some((r) => r.body === body);
}

export const CLAPS_PER_IP_PER_DAY = 100;
