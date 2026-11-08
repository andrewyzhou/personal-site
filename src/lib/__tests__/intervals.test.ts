import { describe, it, expect, vi, beforeEach } from "vitest";

// fake drizzle: a select naming metaEditedAt is the metadata row load
// (metaRow); any other select is the own-row lookup by external id (byIdRows).
// update(...).set(v).where() records v.
const { byIdRows, metaRow, updates, findSame, insert, sources, bySource, hasFile, storeOriginal, storeRaw, republish, invalidate } = vi.hoisted(() => ({
  byIdRows: { value: [] as { id: number }[] },
  metaRow: { value: null as Record<string, unknown> | null },
  updates: [] as Record<string, unknown>[],
  findSame: vi.fn(),
  insert: vi.fn(),
  sources: [] as Record<string, unknown>[],
  bySource: vi.fn(),
  hasFile: vi.fn(),
  storeOriginal: vi.fn(),
  storeRaw: vi.fn(),
  republish: vi.fn(),
  invalidate: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  activities: {},
  getDb: () => ({
    select: (fields?: Record<string, unknown>) => ({
      from: () => ({
        where: () => ({
          limit: async () => (fields && "metaEditedAt" in fields ? (metaRow.value ? [metaRow.value] : []) : byIdRows.value),
        }),
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
  hasDeviceFile: (id: number) => hasFile(id),
  storeOriginal: (...a: unknown[]) => storeOriginal(...a),
  storeRawPayload: (...a: unknown[]) => storeRaw(...a),
}));

vi.mock("@/lib/republish", () => ({ republish: (id: number) => republish(id) }));
vi.mock("@/lib/privacy/stale", () => ({ staleMark: () => ({ needsRepublish: true, staleMarkedAt: "now" }) }));
vi.mock("@/lib/cache", () => ({ invalidateCache: (...a: unknown[]) => invalidate(...a) }));

const parsedSport = vi.hoisted(() => ({ value: "Run" }));
vi.mock("@/lib/fit", () => ({
  parseTrackFile: () => ({
    fileType: "fit",
    sportType: parsedSport.value,
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
  applyIntervalsMetadata,
  handleWebhookEvent,
  parseWebhookEvents,
  pullIntervalsActivities,
} from "@/lib/intervals";
import { UpstreamUnavailableError, withSyncRun } from "@/lib/sync-log";

const FILE_SHA = "f".repeat(64);
const JSON_SHA = "a".repeat(64);
const LEGACY = { pathname: "activities/fit/2026/abc.fit", url: "https://r2.test/activities/fit/2026/abc.fit", sha256: "b".repeat(64) };

// recent, so the pull's 7-day import window includes it
const START = new Date(Date.now() - 2 * 86400000);
const activity = (over: Record<string, unknown> = {}) => ({
  id: "i100",
  name: "Berkeley Running",
  type: "Run",
  source: "GARMIN_CONNECT",
  start_date: START.toISOString().replace(/\.\d+Z$/, "Z"),
  start_date_local: new Date(START.getTime() - 7 * 3600000).toISOString().slice(0, 19),
  elapsed_time: 600,
  ...over,
});

let fetched: string[] = [];
let detail: Record<string, unknown> | null = { id: "i100", icu_training_load: 42 };

function mockApi(list: unknown[], file: Uint8Array | null = new Uint8Array([1, 2, 3])) {
  fetched = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    fetched.push(url);
    if (url.includes("/activities?")) return new Response(JSON.stringify(list));
    if (url.endsWith("/fit-file")) throw new Error("re-encoded file must not be fetched");
    if (url.endsWith("/file")) return file ? new Response(new Blob([new Uint8Array(file)])) : new Response("", { status: 404 });
    if (/\/activity\/i\d+$/.test(url)) return detail ? new Response(JSON.stringify(detail)) : new Response("", { status: 404 });
    throw new Error(`unexpected ${url}`);
  }));
}

const snapshot = (over: Record<string, unknown> = {}) => ({
  provider: "intervals-icu", externalId: "i100", name: "Berkeley Running", description: null, sportType: "Run", hidden: false,
  seenAt: "2026-10-04T00:00:00.000Z", ...over,
});
const linkedRow = (over: Record<string, unknown> = {}) => ({
  id: 5, name: "Berkeley Running", description: null, sportType: "Run", hidden: false,
  metaEditedAt: null, upstreamMeta: snapshot(), ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  byIdRows.value = [];
  metaRow.value = null;
  updates.length = 0;
  sources.length = 0;
  parsedSport.value = "Run";
  detail = { id: "i100", icu_training_load: 42 };
  findSame.mockResolvedValue(null);
  bySource.mockResolvedValue(null);
  hasFile.mockResolvedValue(false);
  insert.mockResolvedValue({ inserted: true, id: 1 });
  storeOriginal.mockResolvedValue({ rawSha256: FILE_SHA, legacy: null });
  storeRaw.mockResolvedValue(JSON_SHA);
  republish.mockResolvedValue({ status: "published" });
  process.env.INTERVALS_ICU_API_KEY = "k";
});

describe("pullIntervalsActivities: new activities", () => {
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
    // the upstream values at import are the baseline for later edits
    expect(row.upstreamMeta).toMatchObject({ provider: "intervals-icu", externalId: "i100", name: "Berkeley Running", sportType: "Run", hidden: false });
    // raw store mode: no legacy public copy on the row
    expect(row.fitBlobPathname).toBeNull();

    expect(sources).toEqual([
      { activityId: 1, provider: "intervals-icu", externalId: "i100", kind: "device-file", rawSha256: FILE_SHA },
      { activityId: 1, provider: "intervals-icu", externalId: "i100", kind: "intervals-activity", rawSha256: JSON_SHA },
    ]);
    expect(republish).toHaveBeenCalledWith(1);
  });

  it("the fit file's sport is the ground truth for the type", async () => {
    parsedSport.value = "TreadmillRun";
    mockApi([activity({ type: "Run" })]);
    await pullIntervalsActivities();
    expect(insert.mock.calls[0][0].sportType).toBe("TreadmillRun");
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

  it("skips stubs synced in from another service without touching them", async () => {
    mockApi([activity({ source: "STRAVA" })]);
    const r = await pullIntervalsActivities();
    expect(r).toMatchObject({ inserted: 0, skipped: 0 });
    expect(insert).not.toHaveBeenCalled();
  });

  it("only imports from the last week; older ones in the metadata window are left alone", async () => {
    const old = new Date(Date.now() - 10 * 86400000).toISOString();
    mockApi([activity({ start_date: old, start_date_local: old.slice(0, 19) })]);
    expect(await pullIntervalsActivities()).toMatchObject({ inserted: 0, skipped: 1 });
    expect(insert).not.toHaveBeenCalled();
    // the list covers the 14-day metadata window
    const listUrl = fetched.find((u) => u.includes("/activities?"))!;
    const oldest = new URL(listUrl).searchParams.get("oldest")!;
    expect(Date.now() - Date.parse(oldest)).toBeGreaterThan(13 * 86400000);
  });

  it("upgrades a row without a file by attaching the original; its name and type stay", async () => {
    findSame.mockResolvedValue({ id: 9, source: "strava-api", fitBlobPathname: null });
    mockApi([activity()]);
    const r = await pullIntervalsActivities();
    expect(r).toMatchObject({ inserted: 0, upgraded: 1 });
    expect(insert).not.toHaveBeenCalled();
    // only the baseline snapshot is written: never name, type or stats
    expect(updates).toHaveLength(1);
    expect(Object.keys(updates[0]).sort()).toEqual(["updatedAt", "upstreamMeta"]);
    expect(sources.map((s) => [s.activityId, s.kind])).toEqual([
      [9, "device-file"],
      [9, "intervals-activity"],
    ]);
    expect(republish).toHaveBeenCalledWith(9);
  });

  it("upgrade in fallback mode also sets the legacy file columns", async () => {
    storeOriginal.mockResolvedValue({ rawSha256: LEGACY.sha256, legacy: LEGACY });
    findSame.mockResolvedValue({ id: 9, source: "manual", fitBlobPathname: null });
    mockApi([activity()]);
    await pullIntervalsActivities();
    expect(updates).toHaveLength(2);
    expect(Object.keys(updates[1]).sort()).toEqual(["fileType", "fitBlobPathname", "fitBlobUrl", "fitSha256", "updatedAt"]);
    expect(republish).toHaveBeenCalledWith(9);
  });

  it("links (never re-imports) rows that already have an original file", async () => {
    findSame.mockResolvedValue({ id: 9, source: "upload", fitBlobPathname: null });
    hasFile.mockResolvedValue(true);
    mockApi([activity()]);
    expect(await pullIntervalsActivities()).toMatchObject({ linked: 1, upgraded: 0, inserted: 0 });
    expect(fetched.some((u) => u.endsWith("/file"))).toBe(false);
    expect(storeOriginal).not.toHaveBeenCalled();
    expect(sources).toEqual([{ activityId: 9, provider: "intervals-icu", externalId: "i100", kind: "intervals-activity", rawSha256: JSON_SHA }]);
    expect(republish).not.toHaveBeenCalled();
  });

  it("falls back to summary stats when there is no file", async () => {
    mockApi([activity({ type: "WeightTraining", moving_time: 3000, elapsed_time: 3300 })], null);
    await pullIntervalsActivities();
    expect(insert.mock.calls[0][0]).toMatchObject({ sportType: "WeightTraining", fileType: null, movingTimeS: 3000, utcOffsetMin: -420 });
    expect(storeOriginal).not.toHaveBeenCalled();
    expect(sources.map((s) => s.kind)).toEqual(["summary", "intervals-activity"]);
    expect(republish).toHaveBeenCalledTimes(1); // published start for summary rows
  });

  it("maps intervals' trainer flag and unknown types without a file", async () => {
    mockApi([activity({ type: "Ride", trainer: true })], null);
    await pullIntervalsActivities();
    expect(insert.mock.calls[0][0].sportType).toBe("IndoorRide");
    insert.mockClear();
    mockApi([activity({ type: "SomethingNew" })], null);
    await pullIntervalsActivities();
    expect(insert.mock.calls[0][0].sportType).toBe("Workout");
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

describe("pullIntervalsActivities: metadata safety net", () => {
  it("applies a rename made upstream to an already-imported row", async () => {
    byIdRows.value = [{ id: 5 }];
    metaRow.value = linkedRow();
    mockApi([activity({ name: "Tempo by the bay" })]);
    const r = await pullIntervalsActivities();
    expect(r).toMatchObject({ updated: 1, inserted: 0 });
    expect(updates[0]).toMatchObject({ name: "Tempo by the bay", upstreamMeta: { name: "Tempo by the bay" } });
    expect(insert).not.toHaveBeenCalled();
    expect(storeOriginal).not.toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalled();
  });

  it("a row attached to another one as a source gets the update too", async () => {
    bySource.mockResolvedValue(9);
    metaRow.value = linkedRow({ id: 9 });
    mockApi([activity({ description: "legs heavy" })]);
    expect(await pullIntervalsActivities()).toMatchObject({ updated: 1 });
    expect(bySource).toHaveBeenCalledWith("intervals-icu", "i100");
    expect(updates[0]).toMatchObject({ description: "legs heavy" });
  });

  it("nothing changed upstream: no write at all", async () => {
    byIdRows.value = [{ id: 5 }];
    metaRow.value = linkedRow();
    mockApi([activity()]);
    expect(await pullIntervalsActivities()).toMatchObject({ updated: 0, skipped: 1 });
    expect(updates).toHaveLength(0);
  });

  it("a site rename after the last sync wins over an upstream rename seen by the pull", async () => {
    byIdRows.value = [{ id: 5 }];
    metaRow.value = linkedRow({ name: "my name", metaEditedAt: { name: "2026-10-05T00:00:00.000Z" } });
    mockApi([activity({ name: "garmin name" })]);
    expect(await pullIntervalsActivities()).toMatchObject({ updated: 0 });
    expect(updates[0]).not.toHaveProperty("name");
    expect(updates[0].upstreamMeta).toMatchObject({ name: "garmin name" });
  });

  it("a type change marks the row for a rebuild", async () => {
    byIdRows.value = [{ id: 5 }];
    metaRow.value = linkedRow();
    mockApi([activity({ type: "TrailRun" })]);
    await pullIntervalsActivities();
    expect(updates[0]).toMatchObject({ sportType: "TrailRun", needsRepublish: true });
  });
});

describe("webhook events", () => {
  it("parses intervals' payload shape, dropping junk, duplicates and other athletes", () => {
    const events = parseWebhookEvents(
      {
        secret: "s",
        events: [
          { athlete_id: "i1", type: "ACTIVITY_UPLOADED", timestamp: "2026-10-03T15:20:00Z", activity: { id: "i100", name: "ignored" } },
          { athlete_id: "i1", type: "ACTIVITY_UPLOADED", timestamp: "2026-10-03T15:20:00Z", activity: { id: "i100" } },
          { athlete_id: "i2", type: "ACTIVITY_UPDATED", activity: { id: "i200" } },
          { athlete_id: "i1", type: "ACTIVITY_UPDATED", activity: { id: "../../etc" } },
          { athlete_id: "i1", type: "ACTIVITY_UPDATED" },
          "nope",
          { athlete_id: "i1", type: "ACTIVITY_UPDATED", timestamp: "bad", activity: { id: 300 } },
        ],
      },
      "i1"
    );
    expect(events).toEqual([
      { type: "ACTIVITY_UPLOADED", activityId: "i100", timestamp: new Date("2026-10-03T15:20:00Z") },
      { type: "ACTIVITY_UPDATED", activityId: "300", timestamp: null },
    ]);
    expect(parseWebhookEvents(null)).toEqual([]);
    expect(parseWebhookEvents({ events: "x" })).toEqual([]);
  });

  it("an upload re-reads the activity from the api and imports it", async () => {
    detail = activity();
    mockApi([]);
    const r = await handleWebhookEvent({ type: "ACTIVITY_UPLOADED", activityId: "i100", timestamp: new Date() });
    expect(r.result).toBe("inserted");
    expect(fetched.filter((u) => /\/activity\/i100$/.test(u))).toHaveLength(1); // the json fetched once, reused
    expect(insert.mock.calls[0][0]).toMatchObject({ name: "Berkeley Running", externalId: "i100" });
    expect(republish).toHaveBeenCalledWith(1);
  });

  it("an update applies the api's current name with the event's time", async () => {
    detail = activity({ name: "renamed in garmin" });
    byIdRows.value = [{ id: 5 }];
    // the site renamed it before the garmin rename happened
    metaRow.value = linkedRow({ name: "site name", metaEditedAt: { name: "2026-10-05T00:00:00.000Z" } });
    mockApi([]);
    const r = await handleWebhookEvent({ type: "ACTIVITY_UPDATED", activityId: "i100", timestamp: new Date("2026-10-06T00:00:00Z") });
    expect(r.result).toBe("updated");
    expect(updates[0]).toMatchObject({ name: "renamed in garmin" });
    // the fresh json is kept as a source
    expect(sources).toEqual([{ activityId: 5, provider: "intervals-icu", externalId: "i100", kind: "intervals-activity", rawSha256: JSON_SHA }]);
  });

  it("an update older than the site's edit leaves the site's value", async () => {
    detail = activity({ name: "renamed in garmin" });
    byIdRows.value = [{ id: 5 }];
    metaRow.value = linkedRow({ name: "site name", metaEditedAt: { name: "2026-10-05T00:00:00.000Z" } });
    mockApi([]);
    const r = await handleWebhookEvent({ type: "ACTIVITY_UPDATED", activityId: "i100", timestamp: new Date("2026-10-04T12:00:00Z") });
    expect(r.result).toBe("unchanged");
    expect(updates[0]).not.toHaveProperty("name");
  });

  it("an update for an activity we don't have yet imports it", async () => {
    detail = activity();
    mockApi([]);
    expect((await handleWebhookEvent({ type: "ACTIVITY_ANALYZED", activityId: "i100", timestamp: null })).result).toBe("inserted");
  });

  it("an update for a deleted activity does nothing", async () => {
    detail = null;
    mockApi([]);
    expect((await handleWebhookEvent({ type: "ACTIVITY_UPDATED", activityId: "i100", timestamp: null })).result).toBe("gone");
    expect(updates).toHaveLength(0);
  });

  it("a delete hides the row only once the api confirms it is gone", async () => {
    byIdRows.value = [{ id: 5 }];
    metaRow.value = linkedRow();
    detail = activity();
    mockApi([]);
    expect((await handleWebhookEvent({ type: "ACTIVITY_DELETED", activityId: "i100", timestamp: new Date() })).result).toBe("ignored");
    expect(updates).toHaveLength(0);

    detail = null;
    mockApi([]);
    expect((await handleWebhookEvent({ type: "ACTIVITY_DELETED", activityId: "i100", timestamp: new Date() })).result).toBe("hidden");
    expect(updates[0]).toMatchObject({ hidden: true });
  });

  it("a delete never overrides a later site un-hide", async () => {
    byIdRows.value = [{ id: 5 }];
    metaRow.value = linkedRow({ metaEditedAt: { hidden: "2026-10-06T00:00:00.000Z" } });
    detail = null;
    mockApi([]);
    const r = await handleWebhookEvent({ type: "ACTIVITY_DELETED", activityId: "i100", timestamp: new Date("2026-10-05T00:00:00Z") });
    expect(r.result).toBe("unchanged");
    expect(updates[0] ?? {}).not.toHaveProperty("hidden");
  });

  it("ignores other event types without calling the api", async () => {
    mockApi([]);
    expect((await handleWebhookEvent({ type: "WELLNESS_UPDATED", activityId: "i100", timestamp: null })).result).toBe("ignored");
    expect(fetched).toHaveLength(0);
  });

  it("stubs from another service are never imported from a webhook", async () => {
    detail = activity({ source: "STRAVA" });
    mockApi([]);
    expect((await handleWebhookEvent({ type: "ACTIVITY_UPLOADED", activityId: "i100", timestamp: null })).result).toBe("ignored");
    expect(insert).not.toHaveBeenCalled();
  });
});

describe("applyIntervalsMetadata", () => {
  it("is a no-op for an activity that isn't linked to any row", async () => {
    expect(await applyIntervalsMetadata("i404", { name: "x" })).toEqual({ rowId: null, applied: [] });
    expect(updates).toHaveLength(0);
  });

  it("first sighting of a linked row records the baseline and keeps its name", async () => {
    byIdRows.value = [{ id: 5 }];
    metaRow.value = linkedRow({ name: "archive name", upstreamMeta: null });
    const r = await applyIntervalsMetadata("i100", { name: "Morning Run", description: null, sportType: "Run" });
    expect(r.applied).toEqual([]);
    expect(updates[0]).not.toHaveProperty("name");
    expect(updates[0].upstreamMeta).toMatchObject({ name: "Morning Run" });
  });
});

// the sync log prints its events to the console when there is no database
function captureEvents() {
  const lines: string[] = [];
  vi.spyOn(console, "log").mockImplementation((line: unknown) => void lines.push(String(line)));
  return lines;
}

describe("sync log and upstream failures", () => {
  it("a 429 on the list ends the pull: the source is skipped for this run", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("slow down", { status: 429 })));
    await expect(pullIntervalsActivities()).rejects.toBeInstanceOf(UpstreamUnavailableError);
  });

  it("a 5xx mid-run stops at once instead of retrying every activity", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      calls.push(url);
      if (url.includes("/activities?")) return new Response(JSON.stringify([activity(), activity({ id: "i101" })]));
      return new Response("down", { status: 503 });
    }));
    await expect(pullIntervalsActivities()).rejects.toThrow("intervals answered 503");
    expect(calls).toHaveLength(2);
    expect(insert).not.toHaveBeenCalled();
  });

  it("every api call is logged with method, host, path, status and bytes", async () => {
    const lines = captureEvents();
    mockApi([activity()]);
    await withSyncRun({ trigger: "poll", source: "activities" }, () => pullIntervalsActivities());
    const calls = lines.filter((l) => l.includes(" api_call "));
    expect(calls.length).toBe(fetched.length);
    expect(calls.some((l) => l.includes('"host":"intervals.icu"') && l.includes('"path":"/api/v1/activity/i100/file"') && l.includes('"bytes":3'))).toBe(true);
    expect(lines.some((l) => l.includes(" insert ") && l.includes("#1"))).toBe(true);
    expect(lines.some((l) => l.includes(" run_end "))).toBe(true);
  });

  it("a rename is logged as update_field with old, new and the winner", async () => {
    const lines = captureEvents();
    byIdRows.value = [{ id: 5 }];
    metaRow.value = linkedRow();
    mockApi([activity({ name: "Tempo by the bay" })]);
    await withSyncRun({ trigger: "poll", source: "activities" }, () => pullIntervalsActivities());
    const line = lines.find((l) => l.includes(" update_field "))!;
    expect(line).toContain('"field":"name"');
    expect(line).toContain('"old":"Berkeley Running"');
    expect(line).toContain('"new":"Tempo by the bay"');
    expect(line).toContain('"winner":"intervals-icu"');
  });

  it("a dry run decides and logs but writes and downloads nothing", async () => {
    const lines = captureEvents();
    const later = new Date(START.getTime() + 3600000).toISOString();
    mockApi([activity(), activity({ id: "i101", start_date: later })]);
    findSame.mockImplementation(async (d: Date) =>
      d.getTime() > START.getTime() + 1000 ? { id: 9, source: "upload", name: "x", fitBlobPathname: null } : null
    );
    const r = await withSyncRun({ trigger: "script", source: "activities", dryRun: true }, () => pullIntervalsActivities());
    expect(r).toMatchObject({ inserted: 1, upgraded: 1 });
    expect(insert).not.toHaveBeenCalled();
    expect(storeOriginal).not.toHaveBeenCalled();
    expect(storeRaw).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
    expect(republish).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
    expect(fetched.some((u) => u.endsWith("/file"))).toBe(false);
    expect(lines.some((l) => l.startsWith("[dry run]") && l.includes(" insert ") && l.includes("would insert"))).toBe(true);
    expect(lines.some((l) => l.startsWith("[dry run]") && l.includes(" merge ") && l.includes("#9"))).toBe(true);
  });

  it("leaves rows garmin follows alone while garmin is on", async () => {
    process.env.GARMIN_PERSONAL_API_KEY = "g";
    try {
      byIdRows.value = [{ id: 5 }];
      metaRow.value = linkedRow({ upstreamMeta: snapshot({ provider: "garmin", externalId: "123" }) });
      mockApi([activity({ name: "Tempo by the bay" })]);
      expect(await pullIntervalsActivities()).toMatchObject({ updated: 0, skipped: 1 });
      expect(updates).toHaveLength(0);
    } finally {
      delete process.env.GARMIN_PERSONAL_API_KEY;
    }
  });

  it("linking to a row garmin follows keeps garmin's snapshot", async () => {
    process.env.GARMIN_PERSONAL_API_KEY = "g";
    try {
      findSame.mockResolvedValue({
        id: 9, source: "garmin", name: "x", fitBlobPathname: null,
        upstreamMeta: snapshot({ provider: "garmin", externalId: "123" }),
      });
      hasFile.mockResolvedValue(true);
      mockApi([activity()]);
      expect(await pullIntervalsActivities()).toMatchObject({ linked: 1 });
      expect(updates).toHaveLength(0);
    } finally {
      delete process.env.GARMIN_PERSONAL_API_KEY;
    }
  });
});
