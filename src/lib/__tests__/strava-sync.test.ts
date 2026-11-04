import { describe, it, expect, vi, beforeEach } from "vitest";

const { known, byIdRows, updates, findSame, insert, sources, bySource, storeRaw, republish, invalidate } = vi.hoisted(() => ({
  known: { value: [] as { externalId: string }[] },
  byIdRows: { value: [] as { id: number }[] },
  updates: [] as Record<string, unknown>[],
  findSame: vi.fn(),
  insert: vi.fn(),
  sources: [] as Record<string, unknown>[],
  bySource: vi.fn(),
  storeRaw: vi.fn(),
  republish: vi.fn(),
  invalidate: vi.fn(),
}));

// fake drizzle: latest-start query → [], known-id query → known, by-id → byIdRows
vi.mock("@/lib/db", () => ({
  activities: {},
  getDb: () => ({
    select: () => ({
      from: () => ({
        orderBy: () => ({ limit: async () => [] }),
        where: () => Object.assign(Promise.resolve(known.value), { limit: async () => byIdRows.value }),
      }),
    }),
    update: () => ({ set: (v: Record<string, unknown>) => ({ where: async () => updates.push(v) }) }),
  }),
}));

vi.mock("@/lib/activities", async (orig) => ({
  ...(await orig<typeof import("@/lib/activities")>()),
  findSameActivity: (d: Date) => findSame(d),
  insertActivity: (v: unknown) => insert(v),
}));

vi.mock("@/lib/activity-sources", () => ({
  addActivitySource: async (s: Record<string, unknown>) => void sources.push(s),
  findActivityIdBySource: (p: string, id: string) => bySource(p, id),
  storeRawPayload: (...a: unknown[]) => storeRaw(...a),
}));

vi.mock("@/lib/republish", () => ({ republish: (id: number) => republish(id) }));
vi.mock("@/lib/cache", () => ({ invalidateCache: (...a: unknown[]) => invalidate(...a) }));
vi.mock("@/lib/strava", () => ({
  getAccessToken: async () => "tok",
  isStravaApiEnabled: () => true,
}));

import { applyStravaUpdate, syncStravaActivities } from "@/lib/strava-sync";

const DETAIL_SHA = "d".repeat(64);
const STREAMS_SHA = "e".repeat(64);

// deliberately odd whitespace: the stored bytes must be exactly these
const DETAIL_TEXT = `{"id":77, "name":"Morning Run","sport_type":"Run","start_date":"2026-10-03T15:02:52Z","utc_offset":-25200,
"distance":1400,"moving_time":600,"elapsed_time":600,"total_elevation_gain":10,"average_speed":2.3,"max_speed":3,
"has_heartrate":false,"map":{"summary_polyline":"abc"}}`;
const STREAMS_TEXT = JSON.stringify({
  time: { data: [0, 300, 600] },
  latlng: { data: [[37.87, -122.26], [37.875, -122.255], [37.88, -122.25]] },
  distance: { data: [0, 700, 1400] },
});

let fetched: string[] = [];

function mockApi({ detail = DETAIL_TEXT, streamsText = STREAMS_TEXT } = {}) {
  fetched = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    fetched.push(url);
    if (url.includes("/athlete/activities")) return new Response(JSON.stringify([{ id: 77, start_date: "2026-10-03T15:02:52Z" }]));
    if (url.includes("/activities/77/streams")) return new Response(streamsText);
    if (url.endsWith("/activities/77")) return new Response(detail);
    throw new Error(`unexpected ${url}`);
  }));
}

const decode = (b: unknown) => new TextDecoder().decode(b as Uint8Array);

beforeEach(() => {
  vi.clearAllMocks();
  known.value = [];
  byIdRows.value = [];
  updates.length = 0;
  sources.length = 0;
  findSame.mockResolvedValue(null);
  bySource.mockResolvedValue(null);
  insert.mockResolvedValue({ inserted: true, id: 5 });
  storeRaw.mockImplementation(async (_b: Uint8Array, kind: string) => (kind === "strava-detail" ? DETAIL_SHA : STREAMS_SHA));
  republish.mockResolvedValue({ status: "published" });
});

describe("syncStravaActivities", () => {
  it("stores detail + streams as exact raw bytes, links them, then republishes", async () => {
    mockApi();
    const r = await syncStravaActivities();
    expect(r).toMatchObject({ inserted: 1, merged: 0, failures: [] });

    const calls = storeRaw.mock.calls.map(([b, kind, meta]) => ({ text: decode(b), kind, meta }));
    expect(calls).toEqual([
      { text: DETAIL_TEXT, kind: "strava-detail", meta: { stravaId: 77 } },
      { text: STREAMS_TEXT, kind: "strava-streams", meta: { stravaId: 77 } },
    ]);

    expect(insert.mock.calls[0][0]).toMatchObject({ source: "strava-api", externalId: "77", fileType: null });
    expect(sources).toEqual([
      { activityId: 5, provider: "strava", externalId: "77", kind: "strava-detail", rawSha256: DETAIL_SHA },
      { activityId: 5, provider: "strava", externalId: "77", kind: "strava-streams", rawSha256: STREAMS_SHA },
    ]);
    expect(republish).toHaveBeenCalledWith(5);
    expect(invalidate).toHaveBeenCalledWith("activities_list", "activities_latest");
  });

  it("links a summary source when no raw store is configured", async () => {
    storeRaw.mockResolvedValue(null);
    mockApi();
    await syncStravaActivities();
    expect(sources).toEqual([{ activityId: 5, provider: "strava", externalId: "77", kind: "summary" }]);
    expect(republish).toHaveBeenCalledWith(5);
  });

  it("dry run fetches but writes nothing: no raw puts, inserts, sources, or republish", async () => {
    mockApi();
    const r = await syncStravaActivities({ dryRun: true });
    expect(r.preview).toHaveLength(1);
    expect(fetched.some((u) => u.includes("/streams"))).toBe(true);
    expect(storeRaw).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
    expect(sources).toHaveLength(0);
    expect(republish).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("merge: stores the detail, links it to the existing row, applies metadata, never republishes", async () => {
    findSame.mockResolvedValue({ id: 9 });
    mockApi();
    const r = await syncStravaActivities();
    expect(r).toMatchObject({ inserted: 0, merged: 1 });
    expect(fetched.some((u) => u.includes("/streams"))).toBe(false);
    expect(storeRaw.mock.calls.map((c) => c[1])).toEqual(["strava-detail"]);
    expect(sources).toEqual([
      { activityId: 9, provider: "strava", externalId: "77", kind: "strava-detail", rawSha256: DETAIL_SHA },
    ]);
    expect(updates[0]).toMatchObject({ name: "Morning Run", sportType: "Run" });
    expect(updates[0]).not.toHaveProperty("polyline");
    expect(insert).not.toHaveBeenCalled();
    expect(republish).not.toHaveBeenCalled();
  });

  it("merge in a dry run writes nothing", async () => {
    findSame.mockResolvedValue({ id: 9 });
    mockApi();
    expect(await syncStravaActivities({ dryRun: true })).toMatchObject({ merged: 1 });
    expect(storeRaw).not.toHaveBeenCalled();
    expect(sources).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });

  it("skips activities already stored by external id", async () => {
    known.value = [{ externalId: "77" }];
    mockApi();
    expect(await syncStravaActivities()).toMatchObject({ inserted: 0, merged: 0 });
    expect(fetched.some((u) => u.endsWith("/activities/77"))).toBe(false);
  });

  it("does not link or republish when the insert hits an existing row", async () => {
    insert.mockResolvedValue({ inserted: false, id: 3 });
    mockApi();
    expect(await syncStravaActivities()).toMatchObject({ inserted: 0, skipped: 1 });
    expect(sources).toHaveLength(0);
    expect(republish).not.toHaveBeenCalled();
  });
});

describe("applyStravaUpdate", () => {
  it("stores the fresh detail and links it to the row before applying metadata", async () => {
    byIdRows.value = [{ id: 5 }];
    mockApi();
    expect(await applyStravaUpdate(77)).toBe(true);
    expect(decode(storeRaw.mock.calls[0][0])).toBe(DETAIL_TEXT);
    expect(sources).toEqual([
      { activityId: 5, provider: "strava", externalId: "77", kind: "strava-detail", rawSha256: DETAIL_SHA },
    ]);
    expect(updates[0]).toMatchObject({ name: "Morning Run" });
    expect(republish).not.toHaveBeenCalled();
  });

  it("finds a merged row through its strava source", async () => {
    bySource.mockResolvedValue(9);
    mockApi();
    expect(await applyStravaUpdate(77)).toBe(true);
    expect(sources[0]).toMatchObject({ activityId: 9 });
    expect(findSame).not.toHaveBeenCalled();
  });

  it("returns false when no row matches", async () => {
    mockApi();
    expect(await applyStravaUpdate(77)).toBe(false);
    expect(sources).toHaveLength(0);
  });
});
