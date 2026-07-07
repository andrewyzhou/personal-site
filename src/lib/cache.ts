import { Redis } from "@upstash/redis";
import { log } from "./log";

// initialize redis client
const redis = new Redis({
  url: process.env.KV_REST_API_URL || "",
  token: process.env.KV_REST_API_TOKEN || "",
});

interface CachedData<T> {
  data: T;
  fetchedAt: number; // unix timestamp in ms
}

interface CachedDataWithPrevious<T> {
  data: T;
  fetchedAt: number; // unix timestamp in ms
  previousFetchedAt: number | null; // previous fetchedAt if data was refetched
  stale?: boolean; // true when the upstream failed and we served the last good value
}

const CACHE_TTL = {
  spotify: 60 * 1000, // 1 minute
  strava: 5 * 60 * 1000, // 5 minutes
  literal: 60 * 60 * 1000, // 1 hour
  activities_list: 5 * 60 * 1000, // 5 minutes — postgres is source of truth
  activities_latest: 60 * 1000, // 1 minute
} as const;

type CacheKey = keyof typeof CACHE_TTL;

// keep last-good values around for a week so an upstream outage can be bridged by
// serving stale data. freshness is controlled by fetchedAt, not this ttl.
const REDIS_SAFETY_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * get cached data from redis, or fetch fresh if stale/missing.
 * - returns previousFetchedAt when data was refetched so UI can show the old time first
 * - if the fresh fetch THROWS and a cached value exists (even expired), serves the
 *   cached value with `stale: true` instead of failing — one dead upstream must
 *   never blank a widget
 * - a fetch that RESOLVES to null is a legitimate empty state: returned as-is and
 *   not cached, so the next request retries
 */
export async function getCachedData<T>(
  key: CacheKey,
  fetchFn: () => Promise<T>
): Promise<CachedDataWithPrevious<T>> {
  let cached: CachedData<T> | null = null;
  try {
    cached = await redis.get<CachedData<T>>(key);
  } catch (error) {
    log.error(`cache:${key}`, "redis read failed, falling through to direct fetch", error);
  }

  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL[key]) {
    // cache is fresh, return it (no previous since we didn't refetch)
    return { ...cached, previousFetchedAt: null };
  }

  // cache is stale or missing, fetch fresh data
  const previousFetchedAt = cached?.fetchedAt ?? null;

  let data: T;
  try {
    data = await fetchFn();
  } catch (error) {
    if (cached) {
      log.warn(`cache:${key}`, "upstream fetch failed, serving stale data", error);
      return { ...cached, previousFetchedAt: null, stale: true };
    }
    throw error;
  }

  // only cache non-null values to avoid caching failed/empty fetches
  if (data !== null) {
    const cacheEntry: CachedData<T> = {
      data,
      fetchedAt: Date.now(),
    };

    try {
      await redis.set(key, cacheEntry, { ex: REDIS_SAFETY_TTL_SECONDS });
    } catch (error) {
      log.error(`cache:${key}`, "redis write failed, returning uncached data", error);
    }

    return { ...cacheEntry, previousFetchedAt };
  }

  // fetch returned null, return it without caching so next request will retry
  return { data, fetchedAt: Date.now(), previousFetchedAt };
}

/**
 * drop cached entries so the next read hits the source of truth — used by
 * activity publish/edit/delete so new data appears immediately despite ttls
 */
export async function invalidateCache(...keys: CacheKey[]): Promise<void> {
  try {
    await Promise.all(keys.map((k) => redis.del(k)));
  } catch (error) {
    log.error("cache:invalidate", `failed to drop ${keys.join(",")}`, error);
  }
}

/**
 * increment api calls counter and return both previous and new count
 */
export async function incrementApiCalls(): Promise<{ prevCount: number; apiCalls: number }> {
  try {
    const prevCount = await redis.get<number>("api_calls") ?? 0;
    const apiCalls = await redis.incr("api_calls");
    return { prevCount, apiCalls };
  } catch (error) {
    log.error("cache:api_calls", "failed to increment api calls", error);
    return { prevCount: 0, apiCalls: 0 };
  }
}
