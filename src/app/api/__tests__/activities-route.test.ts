import { describe, it, expect, vi, beforeEach } from "vitest";
import { isStravaActivity } from "@/lib/validate";

const { getCachedData } = vi.hoisted(() => ({ getCachedData: vi.fn() }));

vi.mock("@/lib/cache", () => ({
  getCachedData: (...args: unknown[]) => getCachedData(...args),
}));

vi.mock("@/lib/db", () => ({
  getDb: vi.fn(),
  activities: {},
  activityPhotos: {},
}));

import { GET as getLatest } from "@/app/api/activities/latest/route";
import { GET as getList } from "@/app/api/activities/route";

beforeEach(() => {
  getCachedData.mockReset();
});

describe("GET /api/activities/latest", () => {
  it("produces a payload that passes isStravaActivity (the contract Currently depends on)", async () => {
    getCachedData.mockResolvedValue({
      data: {
        id: 42,
        name: "morning run",
        type: "Run",
        distance: 8368.2,
        movingTime: 2400,
        elapsedTime: 2520,
        startDate: "2026-07-06T14:12:00.000Z",
      },
      fetchedAt: 1751830000000,
      previousFetchedAt: null,
      stale: false,
    });

    const res = await getLatest();
    const body = await res.json();

    expect(isStravaActivity(body)).toBe(true);
    expect(body.latestActivityId).toBe(42);
    expect(body.formattedDistance).toBe("5.2 mi");
    expect(body.formattedDuration).toBe("42 min");
    expect(typeof body.formattedTimeAgo).toBe("string");
  });

  it("returns literal null when there are no activities", async () => {
    getCachedData.mockResolvedValue({ data: null, fetchedAt: 1, previousFetchedAt: null });
    const res = await getLatest();
    expect(await res.json()).toBeNull();
    expect(res.status).toBe(200);
  });

  it("returns 500 null when db and cache are both dead", async () => {
    getCachedData.mockRejectedValue(new Error("everything down"));
    const res = await getLatest();
    expect(res.status).toBe(500);
    expect(await res.json()).toBeNull();
  });
});

describe("GET /api/activities", () => {
  it("matches the old /api/strava/activities response shape", async () => {
    getCachedData.mockResolvedValue({
      data: [{ id: 1, name: "run", type: "Run", date: "2026-07-01", startTime: "07:00" }],
      fetchedAt: 1751830000000,
      previousFetchedAt: null,
    });
    const res = await getList();
    const body = await res.json();
    expect(body.activities).toHaveLength(1);
    expect(body.lastFetchedAt).toBe(1751830000000);
  });

  it("degrades to the empty shape on total failure", async () => {
    getCachedData.mockRejectedValue(new Error("down"));
    const res = await getList();
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body).toEqual({ activities: [], lastFetchedAt: null });
  });
});
