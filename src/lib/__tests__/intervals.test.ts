import { describe, it, expect, vi, beforeEach } from "vitest";

// fake drizzle: select(...).from().where().limit() resolves to byIdRows;
// update(...).set(v).where() records v
const { byIdRows, updates, findSame, insert, r2Put } = vi.hoisted(() => ({
  byIdRows: { value: [] as { id: number }[] },
  updates: [] as Record<string, unknown>[],
  findSame: vi.fn(),
  insert: vi.fn(),
  r2Put: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  activities: {},
  getDb: () => ({
    select: () => ({ from: () => ({ where: () => ({ limit: async () => byIdRows.value }) }) }),
    update: () => ({ set: (v: Record<string, unknown>) => ({ where: async () => updates.push(v) }) }),
  }),
}));

vi.mock("@/lib/activities", async (orig) => ({
  ...(await orig<typeof import("@/lib/activities")>()),
  findSameActivity: (d: Date) => findSame(d),
  insertActivity: (v: unknown) => insert(v),
}));

vi.mock("@/lib/r2", () => ({
  r2Head: async () => false,
  r2Put: (...a: unknown[]) => r2Put(...a),
  r2PublicUrl: (p: string) => `https://r2.test/${p}`,
}));

vi.mock("@/lib/cache", () => ({ invalidateCache: vi.fn() }));

vi.mock("@/lib/fit", () => ({
  unwrapTrackFile: (b: Uint8Array) => ({ bytes: b, fileType: "fit" }),
  parseTrackFile: () => ({
    fileType: "fit",
    sportType: "Run",
    startDateUtc: new Date("2026-10-03T15:02:52Z"),
    utcOffsetMin: -420,
    hasLocalTime: true,
    records: [
      { lat: 37.87, lng: -122.26, t: 0, ele: 50, hr: 120, cadence: 80, watts: null, speed: 3 },
      { lat: 37.88, lng: -122.25, t: 600, ele: 60, hr: 150, cadence: 82, watts: null, speed: 3 },
    ],
    cumDist: [0, 1400],
    sessionStats: null,
    kilojoules: null,
    suggestedName: "Morning Run",
  }),
}));

import { pullIntervalsActivities } from "@/lib/intervals";

const activity = (over: Record<string, unknown> = {}) => ({
  id: "i100",
  name: "Berkeley Running",
  type: "Run",
  source: "GARMIN_CONNECT",
  start_date: "2026-10-03T15:02:52Z",
  start_date_local: "2026-10-03T08:02:52",
  elapsed_time: 600,
  ...over,
});

function mockApi(list: unknown[], file: Uint8Array | null = new Uint8Array([1, 2, 3])) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.includes("/activities?")) return new Response(JSON.stringify(list));
    if (url.endsWith("/file")) return file ? new Response(new Blob([new Uint8Array(file)])) : new Response("", { status: 404 });
    throw new Error(`unexpected ${url}`);
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  byIdRows.value = [];
  updates.length = 0;
  findSame.mockResolvedValue(null);
  insert.mockResolvedValue({ inserted: true, id: 1 });
  process.env.INTERVALS_ICU_API_KEY = "k";
});

describe("pullIntervalsActivities", () => {
  it("inserts a new garmin activity with its original stored in r2", async () => {
    mockApi([activity()]);
    const r = await pullIntervalsActivities();
    expect(r).toMatchObject({ inserted: 1, upgraded: 0, skipped: 0, failures: [] });
    expect(r2Put).toHaveBeenCalledOnce();
    const row = insert.mock.calls[0][0];
    expect(row).toMatchObject({ source: "intervals-icu", externalId: "i100", name: "Berkeley Running", sportType: "Run" });
    expect(row.fitBlobPathname).toMatch(/^activities\/fit\/2026\//);
  });

  it("skips strava-sourced stubs without touching them", async () => {
    mockApi([activity({ source: "STRAVA" })]);
    const r = await pullIntervalsActivities();
    expect(r).toMatchObject({ inserted: 0, skipped: 0 });
    expect(insert).not.toHaveBeenCalled();
  });

  it("skips activities already pulled", async () => {
    byIdRows.value = [{ id: 5 }];
    mockApi([activity()]);
    expect(await pullIntervalsActivities()).toMatchObject({ inserted: 0, skipped: 1 });
  });

  it("upgrades a strava-api row with the original's route + stats, keeping its name", async () => {
    findSame.mockResolvedValue({ id: 9, source: "strava-api", fitBlobPathname: null });
    mockApi([activity()]);
    const r = await pullIntervalsActivities();
    expect(r).toMatchObject({ inserted: 0, upgraded: 1 });
    expect(insert).not.toHaveBeenCalled();
    expect(updates[0]).toHaveProperty("polyline");
    expect(updates[0]).toHaveProperty("fitBlobPathname");
    expect(updates[0]).not.toHaveProperty("name");
  });

  it("leaves rows that already have an original file alone", async () => {
    findSame.mockResolvedValue({ id: 9, source: "upload", fitBlobPathname: "activities/fit/x.fit" });
    mockApi([activity()]);
    expect(await pullIntervalsActivities()).toMatchObject({ skipped: 1, upgraded: 0 });
    expect(updates).toHaveLength(0);
  });

  it("falls back to summary stats when there is no file", async () => {
    mockApi([activity({ type: "WeightTraining", moving_time: 3000, elapsed_time: 3300 })], null);
    await pullIntervalsActivities();
    expect(insert.mock.calls[0][0]).toMatchObject({
      sportType: "WeightTraining",
      fileType: null,
      localDate: "2026-10-03",
      localTime: "08:02",
      utcOffsetMin: -420,
      movingTimeS: 3000,
    });
  });

  it("reports a rejected api key as an error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 401 })));
    await expect(pullIntervalsActivities()).rejects.toThrow("rejected the api key");
  });
});
