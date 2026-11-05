import { describe, it, expect, vi, beforeEach } from "vitest";

const { results } = vi.hoisted(() => ({ results: [] as unknown[][] }));

// each select(...).from().where().limit() resolves to the next queued result
vi.mock("@/lib/db", () => ({
  activities: { hidden: "hidden", mapHidden: "mapHidden", hrHidden: "hrHidden", id: "id" },
  activityReplays: { data: "data", activityId: "activityId" },
  getDb: () => ({
    select: () => ({ from: () => ({ where: () => ({ limit: async () => results.shift() ?? [] }) }) }),
  }),
}));

import { GET } from "@/app/api/activities/[id]/replay/route";

const replay = {
  v: 1, sportType: "Run", totalS: 10, gaps: [],
  segments: [{ t: [0, 10], lat: [1, 1], lng: [2, 2.001], ele: null, hr: [120, 130], speed: [3, 3] }],
};
const get = (id = "5") => GET(new Request(`http://x/api/activities/${id}/replay`), { params: Promise.resolve({ id }) });

beforeEach(() => {
  results.length = 0;
});

describe("GET /api/activities/[id]/replay", () => {
  it("serves the published replay with private caching only", async () => {
    results.push([{ hidden: false, mapHidden: false, hrHidden: false }], [{ data: replay }]);
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, max-age=60");
    expect((await res.json()).replay.segments[0].hr).toEqual([120, 130]);
  });

  it("strips heart rate when hidden", async () => {
    results.push([{ hidden: false, mapHidden: false, hrHidden: true }], [{ data: replay }]);
    expect((await (await get()).json()).replay.segments[0].hr).toBeNull();
  });

  it("404s for map-hidden, private, missing and bad ids", async () => {
    results.push([{ hidden: false, mapHidden: true, hrHidden: false }]);
    expect((await get()).status).toBe(404);
    results.push([]);
    expect((await get()).status).toBe(404);
    results.push([{ hidden: false, mapHidden: false, hrHidden: false }], [{ data: null }]);
    expect((await get()).status).toBe(404);
    expect((await get("x")).status).toBe(404);
  });
});
