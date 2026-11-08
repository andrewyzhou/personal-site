// engagement plumbing for claps and views: target validation, ip hashing and
// redis fixed-window rate limiting.

import { createHash } from "crypto";
import { Redis } from "@upstash/redis";
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

export const CLAPS_PER_IP_PER_DAY = 100;
