import { describe, it, expect, vi, beforeEach } from "vitest";

const { getCachedData, liftCalendarEntries } = vi.hoisted(() => ({
  getCachedData: vi.fn(),
  liftCalendarEntries: vi.fn(),
}));

vi.mock("@/lib/cache", () => ({
  getCachedData: (...args: unknown[]) => getCachedData(...args),
}));
vi.mock("@/lib/lift/public", () => ({
  liftCalendarEntries: () => liftCalendarEntries(),
}));
vi.mock("@/lib/db", () => ({ getDb: vi.fn(), activities: {} }));

import { GET } from "@/app/api/activities/route";

const run = { id: 1, name: "run", type: "Run", date: "2026-07-01", startTime: "07:00" };
const lift = { id: -42, name: "Push", type: "WeightTraining", date: "2026-07-02", startTime: "18:00", href: "/lifts/share-x" };

beforeEach(() => {
  getCachedData.mockReset();
  liftCalendarEntries.mockReset();
  getCachedData.mockResolvedValue({ data: [run], fetchedAt: 1751830000000, previousFetchedAt: null });
});

describe("GET /api/activities with lift-only workouts", () => {
  it("keeps `activities` exactly as before and adds lifts beside it", async () => {
    liftCalendarEntries.mockResolvedValue([lift]);
    const body = await (await GET()).json();
    expect(body.activities).toEqual([run]);
    expect(body.lifts).toEqual([lift]);
    expect(body.lastFetchedAt).toBe(1751830000000);
    // lifts never enter the shared activities cache
    expect(getCachedData).toHaveBeenCalledWith("activities_list", expect.any(Function));
  });

  it("an empty lift list is still the same activities payload", async () => {
    liftCalendarEntries.mockResolvedValue([]);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.activities).toEqual([run]);
    expect(body.lifts).toEqual([]);
  });
});
