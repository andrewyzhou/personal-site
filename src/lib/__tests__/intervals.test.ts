import { describe, it, expect, vi, beforeEach } from "vitest";

// fake drizzle: select(...).from().where().limit() resolves to byIdRows;
// update(...).set(v).where() records v
const { byIdRows, updates, findSame, insert, sources, bySource, storeOriginal, storeRaw, republish } = vi.hoisted(() => ({
  byIdRows: { value: [] as { id: number }[] },
  updates: [] as Record<string, unknown>[],
  findSame: vi.fn(),
  insert: vi.fn(),
  sources: [] as Record<string, unknown>[],
  bySource: vi.fn(),
  storeOriginal: vi.fn(),
  storeRaw: vi.fn(),
  republish: vi.fn(),
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

vi.mock("@/lib/activity-sources", () => ({
  addActivitySource: async (s: Record<string, unknown>) => void sources.push(s),
  findActivityIdBySource: (p: string, id: string) => bySource(p, id),
  storeOriginal: (...a: unknown[]) => storeOriginal(...a),
  storeRawPayload: (...a: unknown[]) => storeRaw(...a),
}));

vi.mock("@/lib/republish", () => ({ republish: (id: number) => republish(id) }));

vi.mock("@/lib/cache", () => ({ invalidateCache: vi.fn() }));

vi.mock("@/lib/fit", () => ({
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

const FILE_SHA = "f".repeat(64);
const JSON_SHA = "a".repeat(64);
const LEGACY = { pathname: "activities/fit/2026/abc.fit", url: "https://r2.test/activities/fit/2026/abc.fit", sha256: "b".repeat(64) };

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

let fetched: string[] = [];

function mockApi(list: unknown[], file: Uint8Array | null = new Uint8Array([1, 2, 3])) {
  fetched = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    fetched.push(url);
    if (url.includes("/activities?")) return new Response(JSON.stringify(list));
    if (url.endsWith("/fit-file")) throw new Error("re-encoded file must not be fetched");
    if (url.endsWith("/file")) return file ? new Response(new Blob([new Uint8Array(file)])) : new Response("", { status: 404 });
    if (/\/activity\/i\d+$/.test(url)) return new Response('{"id":"i100","icu_training_load":42}');
    throw new Error(`unexpected ${url}`);
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  byIdRows.value = [];
  updates.length = 0;
  sources.length = 0;
  findSame.mockResolvedValue(null);
  bySource.mockResolvedValue(null);
  insert.mockResolvedValue({ inserted: true, id: 1 });
  storeOriginal.mockResolvedValue({ rawSha256: FILE_SHA, legacy: null });
  storeRaw.mockResolvedValue(JSON_SHA);
  republish.mockResolvedValue({ status: "published" });
  process.env.INTERVALS_ICU_API_KEY = "k";
});

describe("pullIntervalsActivities", () => {
  it("stores the original from /file and the activity json, links both, then republishes", async () => {
    mockApi([activity()]);
    const r = await pullIntervalsActivities();
    expect(r).toMatchObject({ inserted: 1, upgraded: 0, skipped: 0, failures: [] });

    expect(fetched.some((u) => u.endsWith("/activity/i100/file"))).toBe(true);
    expect(fetched.some((u) => u.includes("fit-file"))).toBe(false);

    const [bytes, filename, , meta] = storeOriginal.mock.calls[0];
    expect(Array.from(bytes as Uint8Array)).toEqual([1, 2, 3]);
    expect(filename).toBe("i100.fit");
    expect(meta).toMatchObject({ provider: "intervals-icu", externalId: "i100" });

    const [jsonBytes, kind] = storeRaw.mock.calls[0];
    expect(new TextDecoder().decode(jsonBytes as Uint8Array)).toBe('{"id":"i100","icu_training_load":42}');
    expect(kind).toBe("intervals-activity");

    const row = insert.mock.calls[0][0];
    expect(row).toMatchObject({ source: "intervals-icu", externalId: "i100", name: "Berkeley Running", sportType: "Run" });
    // raw store mode: no legacy public copy on the row
    expect(row.fitBlobPathname).toBeNull();

    expect(sources).toEqual([
      { activityId: 1, provider: "intervals-icu", externalId: "i100", kind: "device-file", rawSha256: FILE_SHA },
      { activityId: 1, provider: "intervals-icu", externalId: "i100", kind: "intervals-activity", rawSha256: JSON_SHA },
    ]);
    expect(republish).toHaveBeenCalledWith(1);
  });

  it("writes the legacy fit columns only in fallback mode", async () => {
    storeOriginal.mockResolvedValue({ rawSha256: LEGACY.sha256, legacy: LEGACY });
    storeRaw.mockResolvedValue(null);
    mockApi([activity()]);
    await pullIntervalsActivities();
    expect(insert.mock.calls[0][0]).toMatchObject({ fitBlobPathname: LEGACY.pathname, fitSha256: LEGACY.sha256 });
    expect(sources).toEqual([
      { activityId: 1, provider: "intervals-icu", externalId: "i100", kind: "device-file", rawSha256: LEGACY.sha256 },
    ]);
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

  it("skips activities already attached to another row as a source", async () => {
    bySource.mockResolvedValue(9);
    mockApi([activity()]);
    expect(await pullIntervalsActivities()).toMatchObject({ inserted: 0, upgraded: 0, skipped: 1 });
    expect(bySource).toHaveBeenCalledWith("intervals-icu", "i100");
    expect(fetched.some((u) => u.includes("/activity/"))).toBe(false);
    expect(storeOriginal).not.toHaveBeenCalled();
    expect(republish).not.toHaveBeenCalled();
  });

  it("upgrades a strava-api row by attaching the original and republishing, never writing stats", async () => {
    findSame.mockResolvedValue({ id: 9, source: "strava-api", fitBlobPathname: null });
    mockApi([activity()]);
    const r = await pullIntervalsActivities();
    expect(r).toMatchObject({ inserted: 0, upgraded: 1 });
    expect(insert).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
    expect(sources.map((s) => [s.activityId, s.kind])).toEqual([
      [9, "device-file"],
      [9, "intervals-activity"],
    ]);
    expect(republish).toHaveBeenCalledWith(9);
  });

  it("upgrade in fallback mode sets only the legacy file columns", async () => {
    storeOriginal.mockResolvedValue({ rawSha256: LEGACY.sha256, legacy: LEGACY });
    findSame.mockResolvedValue({ id: 9, source: "strava-api", fitBlobPathname: null });
    mockApi([activity()]);
    await pullIntervalsActivities();
    expect(updates).toHaveLength(1);
    expect(Object.keys(updates[0]).sort()).toEqual(["fileType", "fitBlobPathname", "fitBlobUrl", "fitSha256", "updatedAt"]);
    expect(republish).toHaveBeenCalledWith(9);
  });

  it("leaves rows that already have an original file alone", async () => {
    findSame.mockResolvedValue({ id: 9, source: "upload", fitBlobPathname: "activities/fit/x.fit" });
    mockApi([activity()]);
    expect(await pullIntervalsActivities()).toMatchObject({ skipped: 1, upgraded: 0 });
    expect(updates).toHaveLength(0);
    expect(sources).toHaveLength(0);
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
    expect(storeOriginal).not.toHaveBeenCalled();
    expect(sources.map((s) => s.kind)).toEqual(["summary", "intervals-activity"]);
    expect(republish).not.toHaveBeenCalled();
  });

  it("does not attach sources when the insert hits an existing row", async () => {
    insert.mockResolvedValue({ inserted: false, id: 3 });
    mockApi([activity()]);
    expect(await pullIntervalsActivities()).toMatchObject({ inserted: 0, skipped: 1 });
    expect(sources).toHaveLength(0);
    expect(republish).not.toHaveBeenCalled();
  });

  it("reports a rejected api key as an error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 401 })));
    await expect(pullIntervalsActivities()).rejects.toThrow("rejected the api key");
  });
});
