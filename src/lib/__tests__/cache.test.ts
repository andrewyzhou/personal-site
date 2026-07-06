import { describe, it, expect, vi, beforeEach } from "vitest";

const { redisGet, redisSet, redisIncr } = vi.hoisted(() => ({
  redisGet: vi.fn(),
  redisSet: vi.fn(),
  redisIncr: vi.fn(),
}));

vi.mock("@upstash/redis", () => ({
  Redis: class {
    get = redisGet;
    set = redisSet;
    incr = redisIncr;
  },
}));

import { getCachedData } from "../cache";

// use the shortest ttl key (spotify: 60s) for all cases
const KEY = "spotify" as const;

beforeEach(() => {
  vi.restoreAllMocks();
  redisGet.mockReset();
  redisSet.mockReset();
  redisIncr.mockReset();
  redisSet.mockResolvedValue("OK");
});

describe("getCachedData", () => {
  it("returns fresh cache without calling fetchFn", async () => {
    const cached = { data: "cached-value", fetchedAt: Date.now() - 1000 };
    redisGet.mockResolvedValue(cached);
    const fetchFn = vi.fn();

    const result = await getCachedData(KEY, fetchFn);

    expect(result.data).toBe("cached-value");
    expect(result.previousFetchedAt).toBeNull();
    expect(result.stale).toBeUndefined();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("refetches when cache is stale and reports previousFetchedAt", async () => {
    const oldFetchedAt = Date.now() - 10 * 60 * 1000;
    redisGet.mockResolvedValue({ data: "old", fetchedAt: oldFetchedAt });
    const fetchFn = vi.fn().mockResolvedValue("new");

    const result = await getCachedData(KEY, fetchFn);

    expect(result.data).toBe("new");
    expect(result.previousFetchedAt).toBe(oldFetchedAt);
    expect(redisSet).toHaveBeenCalledOnce();
  });

  it("serves stale data with stale flag when the fetch throws", async () => {
    const oldFetchedAt = Date.now() - 10 * 60 * 1000;
    redisGet.mockResolvedValue({ data: "last-good", fetchedAt: oldFetchedAt });
    const fetchFn = vi.fn().mockRejectedValue(new Error("upstream down"));

    const result = await getCachedData(KEY, fetchFn);

    expect(result.data).toBe("last-good");
    expect(result.stale).toBe(true);
    // must not overwrite the last good value
    expect(redisSet).not.toHaveBeenCalled();
  });

  it("rethrows when the fetch throws and no cache exists", async () => {
    redisGet.mockResolvedValue(null);
    const fetchFn = vi.fn().mockRejectedValue(new Error("upstream down"));

    await expect(getCachedData(KEY, fetchFn)).rejects.toThrow("upstream down");
  });

  it("falls through to a direct fetch when redis read fails", async () => {
    redisGet.mockRejectedValue(new Error("redis down"));
    const fetchFn = vi.fn().mockResolvedValue("fetched");

    const result = await getCachedData(KEY, fetchFn);

    expect(result.data).toBe("fetched");
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it("still returns data when the redis write fails", async () => {
    redisGet.mockResolvedValue(null);
    redisSet.mockRejectedValue(new Error("redis down"));
    const fetchFn = vi.fn().mockResolvedValue("fetched");

    const result = await getCachedData(KEY, fetchFn);

    expect(result.data).toBe("fetched");
  });

  it("does not cache a null fetch result (legitimate empty state)", async () => {
    redisGet.mockResolvedValue(null);
    const fetchFn = vi.fn().mockResolvedValue(null);

    const result = await getCachedData(KEY, fetchFn);

    expect(result.data).toBeNull();
    expect(redisSet).not.toHaveBeenCalled();
  });
});
