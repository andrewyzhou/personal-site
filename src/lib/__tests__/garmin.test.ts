import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// fake drizzle. selects: a `.limit()` is the own-row lookup (ownRows) or the
// metadata row (metaRow, when the select names metaEditedAt); a select awaited
// without `.limit()` is the device-file sha lookup (fileShas).
const h = vi.hoisted(() => ({
  ownRows: { value: [] as { id: number }[] },
  metaRow: { value: null as Record<string, unknown> | null },
  fileShas: { value: [] as { sha: string }[] },
  updates: [] as Record<string, unknown>[],
  sources: [] as Record<string, unknown>[],
  kv: new Map<string, unknown>(),
  kvSets: [] as { key: string; ttl: number }[],
  findSame: vi.fn(),
  insert: vi.fn(),
  bySource: vi.fn(),
  hasFile: vi.fn(),
  storeOriginal: vi.fn(),
  storeRaw: vi.fn(),
  republish: vi.fn(),
  invalidate: vi.fn(),
  innerBytes: { value: new Uint8Array([9, 9, 9]) },
}));

vi.mock("@/lib/db", () => ({
  activities: {},
  activitySources: {},
  getDb: () => ({
    select: (fields?: Record<string, unknown>) => ({
      from: () => ({
        where: () => {
          const rows = fields && "sha" in fields ? h.fileShas.value : [];
          return Object.assign(Promise.resolve(rows), {
            limit: async () => (fields && "metaEditedAt" in fields ? (h.metaRow.value ? [h.metaRow.value] : []) : h.ownRows.value),
          });
        },
      }),
    }),
    update: () => ({ set: (v: Record<string, unknown>) => ({ where: async () => h.updates.push(v) }) }),
  }),
}));

vi.mock("@/lib/activities", async (orig) => ({
  ...(await orig<typeof import("@/lib/activities")>()),
  findSameActivity: (d: Date) => h.findSame(d),
  insertActivity: (v: unknown) => h.insert(v),
}));

vi.mock("@/lib/activity-sources", () => ({
  addActivitySource: async (s: Record<string, unknown>) => void h.sources.push(s),
  findActivityIdBySource: (p: string, id: string) => h.bySource(p, id),
  hasDeviceFile: (id: number) => h.hasFile(id),
  storeOriginal: (...a: unknown[]) => h.storeOriginal(...a),
  storeRawPayload: (...a: unknown[]) => h.storeRaw(...a),
}));

vi.mock("@/lib/republish", () => ({ republish: (id: number) => h.republish(id) }));
vi.mock("@/lib/privacy/stale", () => ({ staleMark: () => ({ needsRepublish: true }) }));
vi.mock("@/lib/cache", () => ({
  invalidateCache: (...a: unknown[]) => h.invalidate(...a),
  kvGet: async (k: string) => h.kv.get(k) ?? null,
  kvSet: async (k: string, v: unknown, ttl: number) => {
    h.kv.set(k, v);
    h.kvSets.push({ key: k, ttl });
  },
  kvDel: async (k: string) => void h.kv.delete(k),
}));

vi.mock("@/lib/fit", () => ({
  unwrapTrackFile: () => ({ bytes: h.innerBytes.value, fileType: "fit" }),
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

import {
  activityRecords,
  garminOffsetMin,
  garminStart,
  garminUpstreamValues,
  getGarminToken,
  jwtExpiration,
  pullGarminActivities,
} from "@/lib/garmin";
import { garminSportType } from "@/lib/sport-map";
import { sha256Hex } from "@/lib/raw-store";
import { UpstreamUnavailableError, withSyncRun } from "@/lib/sync-log";

const BASE = "https://personal.connectapi.garmin.com";
const FILE_SHA = "f".repeat(64);
const JSON_SHA = "a".repeat(64);
const ZIP = new Uint8Array([0x50, 0x4b, 3, 4, 1, 2]);

const jwt = (exp: number) =>
  `h.${Buffer.from(JSON.stringify({ exp })).toString("base64url")}.sig`;

// recent, inside the import window
const START = new Date(Date.now() - 2 * 86400000);
START.setUTCMilliseconds(0);
const gmt = START.toISOString().slice(0, 19).replace("T", " ");
const local = new Date(START.getTime() - 7 * 3600000).toISOString().slice(0, 19).replace("T", " ");
const fixture = JSON.parse(
  readFileSync(join(__dirname, "fixtures/garmin/search-activities.json"), "utf8").replace("__GMT__", gmt).replace("__LOCAL__", local)
) as Record<string, unknown>[];
const ID = "17283940001";

let calls: { url: string; init: RequestInit }[] = [];
let list: unknown = fixture;
let file: Uint8Array | null = ZIP;
let status: Record<string, number> = {};

function mockApi() {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    const path = new URL(url).pathname;
    const forced = Object.entries(status).find(([p]) => path.startsWith(p));
    if (forced) return new Response("x", { status: forced[1] });
    if (path.endsWith("/personal-api-key/token")) return new Response(jwt(Math.floor(Date.now() / 1000) + 86400));
    if (path === "/activitylist-service/activities/search/activities") return new Response(JSON.stringify(list));
    if (path.startsWith("/activity-service/activity/")) return new Response(JSON.stringify({ activityId: Number(ID), summaryDTO: {} }));
    if (path.startsWith("/download-service/files/activity/")) return file ? new Response(new Blob([new Uint8Array(file)])) : new Response("", { status: 404 });
    throw new Error(`unexpected ${url}`);
  }));
}

const snapshot = (over: Record<string, unknown> = {}) => ({
  provider: "garmin", externalId: ID, name: "Berkeley Running", description: null, sportType: "Run", hidden: false,
  seenAt: "2026-10-04T00:00:00.000Z", ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  h.ownRows.value = [];
  h.metaRow.value = null;
  h.fileShas.value = [];
  h.updates.length = 0;
  h.sources.length = 0;
  h.kv.clear();
  h.kvSets.length = 0;
  h.innerBytes.value = new Uint8Array([9, 9, 9]);
  h.findSame.mockResolvedValue(null);
  h.bySource.mockResolvedValue(null);
  h.hasFile.mockResolvedValue(false);
  h.insert.mockResolvedValue({ inserted: true, id: 1 });
  h.storeOriginal.mockResolvedValue({ rawSha256: FILE_SHA, legacy: null });
  h.storeRaw.mockResolvedValue(JSON_SHA);
  h.republish.mockResolvedValue({ status: "published" });
  list = fixture;
  file = ZIP;
  status = {};
  process.env.GARMIN_PERSONAL_API_KEY = "my-key";
  delete process.env.GARMIN_PERSONAL_API_BASE_URL;
  mockApi();
});

describe("mapping", () => {
  it("reads the start from startTimeGMT (utc) and the offset from startTimeLocal", () => {
    const a = fixture[0] as never;
    expect(garminStart(a)?.toISOString()).toBe(START.toISOString());
    expect(garminOffsetMin(a)).toBe(-420);
    expect(garminStart({ activityId: 1, beginTimestamp: 1_700_000_000_000 })?.getTime()).toBe(1_700_000_000_000);
    expect(garminStart({ activityId: 1 })).toBeNull();
  });

  it("accepts the search answer as a list or wrapped (as the reference client does)", () => {
    expect(activityRecords([{ activityId: 1 }, { nope: 1 }, null])).toHaveLength(1);
    expect(activityRecords({ activities: [{ activityId: 1 }] })).toHaveLength(1);
    expect(activityRecords({ activityList: [{ activityId: "2" }] })).toHaveLength(1);
    expect(activityRecords("junk")).toEqual([]);
  });

  it("only reports the fields garmin sent: a missing description is never blanked", () => {
    expect(garminUpstreamValues({ activityId: 1, activityName: "x", activityType: { typeKey: "trail_running" } })).toEqual({
      name: "x",
      sportType: "TrailRun",
    });
    expect(garminUpstreamValues({ activityId: 1, description: null })).toEqual({ description: null });
  });

  it("maps garmin typeKeys onto site sport types", () => {
    expect(garminSportType("running")).toBe("Run");
    expect(garminSportType("treadmill_running")).toBe("TreadmillRun");
    expect(garminSportType("indoor_cycling")).toBe("IndoorRide");
    expect(garminSportType("strength_training")).toBe("WeightTraining");
    expect(garminSportType("resort_skiing_snowboarding_ws")).toBe("AlpineSki");
    expect(garminSportType("lap_swimming")).toBe("Swim");
    expect(garminSportType("some_new_running_thing")).toBe("Run");
    expect(garminSportType("other")).toBe("Workout");
    expect(garminSportType(null)).toBe("Workout");
  });
});

describe("token", () => {
  it("reads exp from the jwt", () => {
    expect(jwtExpiration(jwt(1234))).toBe(1234);
    expect(() => jwtExpiration("not-a-jwt")).toThrow("exp claim");
  });

  it("exchanges the key with an ApiKey header and caches the token until an hour before it expires", async () => {
    const token = await getGarminToken();
    expect(calls[0].url).toBe(`${BASE}/personalapitoken-service/personal-api/personal-api-key/token`);
    expect(calls[0].init.method).toBe("POST");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("ApiKey my-key");
    expect(jwtExpiration(token)).toBeGreaterThan(Date.now() / 1000);
    expect(h.kvSets).toHaveLength(1);
    expect(h.kvSets[0].ttl).toBeGreaterThan(22 * 3600 - 5);
    expect(h.kvSets[0].ttl).toBeLessThanOrEqual(23 * 3600 + 1);
    // the key itself is never the cache key
    expect(h.kvSets[0].key).not.toContain("my-key");

    await getGarminToken();
    expect(calls).toHaveLength(1);
  });

  it("a cached token inside the refresh window is replaced", async () => {
    await getGarminToken();
    const key = h.kvSets[0].key;
    h.kv.set(key, { token: "old", expiresAt: Math.floor(Date.now() / 1000) + 1800 });
    const token = await getGarminToken();
    expect(token).not.toBe("old");
    expect(calls).toHaveLength(2);
  });

  it("a rejected key is an error; a 429/5xx is an unavailable upstream", async () => {
    status = { "/personalapitoken-service": 401 };
    await expect(getGarminToken()).rejects.toThrow("token exchange: 401");
    status = { "/personalapitoken-service": 503 };
    await expect(getGarminToken()).rejects.toBeInstanceOf(UpstreamUnavailableError);
  });

  it("a dry run never writes the token to kv", async () => {
    await withSyncRun({ trigger: "script", source: "garmin", dryRun: true }, () => getGarminToken());
    expect(h.kvSets).toHaveLength(0);
  });
});

describe("pullGarminActivities", () => {
  it("searches by date with start/limit, sends the bearer token, never logs it", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((l: unknown) => void lines.push(String(l)));
    await withSyncRun({ trigger: "poll", source: "activities" }, () => pullGarminActivities());
    const search = calls.find((c) => c.url.includes("/activities/search/activities"))!;
    const q = new URL(search.url).searchParams;
    expect(q.get("start")).toBe("0");
    expect(q.get("limit")).toBe("50");
    expect(q.get("startDate")).toMatch(/^\d{4}-\d\d-\d\d$/);
    expect(q.get("endDate")).toMatch(/^\d{4}-\d\d-\d\d$/);
    expect((search.init.headers as Record<string, string>).Authorization).toMatch(/^Bearer h\./);
    const logged = lines.join("\n");
    expect(logged).toContain('"host":"personal.connectapi.garmin.com"');
    expect(logged).not.toContain("my-key");
    expect(logged).not.toContain("Bearer");
  });

  it("imports a new activity: original zip + activity json kept raw and linked, then republished", async () => {
    const r = await pullGarminActivities();
    expect(r).toMatchObject({ inserted: 1, upgraded: 0, linked: 0, failures: [] });
    const download = calls.find((c) => c.url.includes("/download-service/files/activity/"))!;
    expect(download.url).toBe(`${BASE}/download-service/files/activity/${ID}`);
    expect((download.init.headers as Record<string, string>).Accept).toContain("application/zip");

    const [bytes, filename, , meta] = h.storeOriginal.mock.calls[0];
    expect(Array.from(bytes as Uint8Array)).toEqual(Array.from(ZIP));
    expect(filename).toBe(`${ID}.zip`);
    expect(meta).toMatchObject({ provider: "garmin", externalId: ID });
    expect(h.storeRaw.mock.calls[0][1]).toBe("garmin-activity");

    const row = h.insert.mock.calls[0][0];
    expect(row).toMatchObject({ source: "garmin", externalId: ID, name: "Berkeley Running", sportType: "Run" });
    expect(row.upstreamMeta).toMatchObject({ provider: "garmin", externalId: ID, name: "Berkeley Running", sportType: "Run" });
    expect(h.sources).toEqual([
      { activityId: 1, provider: "garmin", externalId: ID, kind: "device-file", rawSha256: FILE_SHA },
      { activityId: 1, provider: "garmin", externalId: ID, kind: "garmin-activity", rawSha256: JSON_SHA },
    ]);
    expect(h.republish).toHaveBeenCalledWith(1);
  });

  it("no original: a summary row from the list's stats", async () => {
    file = null;
    await pullGarminActivities();
    expect(h.insert.mock.calls[0][0]).toMatchObject({
      source: "garmin",
      fileType: null,
      distanceM: 8046.7,
      movingTimeS: 2690,
      elapsedTimeS: 2755,
      avgHr: 151,
      utcOffsetMin: -420,
    });
    expect(h.sources.map((s) => s.kind)).toEqual(["summary", "garmin-activity"]);
  });

  it("the same workout already here with no file: garmin's original is attached, its name kept", async () => {
    h.findSame.mockResolvedValue({ id: 9, source: "intervals-icu", name: "x", fitBlobPathname: null, fitSha256: null });
    expect(await pullGarminActivities()).toMatchObject({ upgraded: 1, inserted: 0 });
    expect(h.insert).not.toHaveBeenCalled();
    // garmin's snapshot becomes the row's metadata baseline; nothing else changes
    expect(Object.keys(h.updates[0]).sort()).toEqual(["updatedAt", "upstreamMeta"]);
    expect(h.updates[0].upstreamMeta).toMatchObject({ provider: "garmin" });
    expect(h.sources.map((s) => [s.activityId, s.kind])).toEqual([
      [9, "device-file"],
      [9, "garmin-activity"],
    ]);
    expect(h.republish).toHaveBeenCalledWith(9);
  });

  it("the same workout with an identical fit already attached: linked, one copy kept", async () => {
    h.findSame.mockResolvedValue({ id: 9, source: "intervals-icu", name: "x", fitBlobPathname: null, fitSha256: null });
    h.hasFile.mockResolvedValue(true);
    h.fileShas.value = [{ sha: sha256Hex(h.innerBytes.value) }];
    expect(await pullGarminActivities()).toMatchObject({ linked: 1 });
    expect(h.storeOriginal).not.toHaveBeenCalled();
    expect(h.sources).toEqual([{ activityId: 9, provider: "garmin", externalId: ID, kind: "garmin-activity", rawSha256: JSON_SHA }]);
    expect(h.republish).not.toHaveBeenCalled();
  });

  it("the same workout with a different fit attached: garmin's is kept raw too, the published one stays", async () => {
    h.findSame.mockResolvedValue({ id: 9, source: "intervals-icu", name: "x", fitBlobPathname: null, fitSha256: null });
    h.hasFile.mockResolvedValue(true);
    h.fileShas.value = [{ sha: "c".repeat(64) }];
    expect(await pullGarminActivities()).toMatchObject({ linked: 1 });
    expect(h.storeOriginal).toHaveBeenCalledTimes(1);
    expect(h.sources.map((s) => s.kind)).toEqual(["device-file", "garmin-activity"]);
    expect(h.republish).not.toHaveBeenCalled();
  });

  it("applies a rename made in garmin connect to a row garmin follows", async () => {
    h.ownRows.value = [{ id: 5 }];
    h.metaRow.value = { id: 5, name: "Berkeley Running", description: null, sportType: "Run", hidden: false, metaEditedAt: null, upstreamMeta: snapshot() };
    list = [{ ...fixture[0], activityName: "Tempo by the bay" }];
    expect(await pullGarminActivities()).toMatchObject({ updated: 1, inserted: 0 });
    expect(h.updates[0]).toMatchObject({ name: "Tempo by the bay", upstreamMeta: { provider: "garmin", name: "Tempo by the bay" } });
    expect(h.invalidate).toHaveBeenCalled();
  });

  it("a type change in garmin connect is applied and marks the row stale", async () => {
    h.ownRows.value = [{ id: 5 }];
    h.metaRow.value = { id: 5, name: "Berkeley Running", description: null, sportType: "Run", hidden: false, metaEditedAt: null, upstreamMeta: snapshot() };
    list = [{ ...fixture[0], activityType: { typeKey: "trail_running" } }];
    await pullGarminActivities();
    expect(h.updates[0]).toMatchObject({ sportType: "TrailRun", needsRepublish: true });
  });

  it("a 429 ends the pull without touching anything", async () => {
    status = { "/download-service": 429 };
    await expect(pullGarminActivities()).rejects.toBeInstanceOf(UpstreamUnavailableError);
    expect(h.insert).not.toHaveBeenCalled();
  });

  it("a revoked token drops the cached one", async () => {
    await getGarminToken();
    expect(h.kv.size).toBe(1);
    status = { "/activitylist-service": 401 };
    await expect(pullGarminActivities()).rejects.toThrow("rejected the bearer token");
    expect(h.kv.size).toBe(0);
  });

  it("a dry run lists and decides but downloads and writes nothing", async () => {
    const r = await withSyncRun({ trigger: "script", source: "activities", dryRun: true }, () => pullGarminActivities());
    expect(r).toMatchObject({ inserted: 1 });
    expect(calls.some((c) => c.url.includes("/download-service/"))).toBe(false);
    expect(h.insert).not.toHaveBeenCalled();
    expect(h.storeOriginal).not.toHaveBeenCalled();
    expect(h.storeRaw).not.toHaveBeenCalled();
    expect(h.updates).toHaveLength(0);
  });
});
