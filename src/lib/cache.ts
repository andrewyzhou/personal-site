import { Redis } from "@upstash/redis";

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
}

const CACHE_TTL = {
  spotify: 60 * 1000, // 1 minute
  strava: 5 * 60 * 1000, // 5 minutes
  literal: 60 * 60 * 1000, // 1 hour
} as const;

type CacheKey = keyof typeof CACHE_TTL;

/**
 * get cached data from redis, or fetch fresh if stale/missing
 * returns previousFetchedAt when data was refetched so UI can show the old time first
 */
export async function getCachedData<T>(
  key: CacheKey,
  fetchFn: () => Promise<T>
): Promise<CachedDataWithPrevious<T>> {
  try {
    // try to get cached data
    const cached = await redis.get<CachedData<T>>(key);

    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL[key]) {
      // cache is fresh, return it (no previous since we didn't refetch)
      return { ...cached, previousFetchedAt: null };
    }

    // cache is stale or missing, fetch fresh data
    const previousFetchedAt = cached?.fetchedAt ?? null;
    const data = await fetchFn();
    const cacheEntry: CachedData<T> = {
      data,
      fetchedAt: Date.now(),
    };

    // store in redis (set TTL to 24 hours as a safety - we control freshness via timestamp)
    await redis.set(key, cacheEntry, { ex: 86400 });

    return { ...cacheEntry, previousFetchedAt };
  } catch (error) {
    // if redis fails, fall back to direct fetch
    console.error(`Cache error for ${key}:`, error);
    const data = await fetchFn();
    return {
      data,
      fetchedAt: Date.now(),
      previousFetchedAt: null,
    };
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
    console.error("failed to increment api calls:", error);
    return { prevCount: 0, apiCalls: 0 };
  }
}

