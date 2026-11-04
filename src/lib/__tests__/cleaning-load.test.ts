import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { unwrapTrackFile } from "../fit";
import { sha256Hex } from "../raw-store";
import { canonicalFromDeviceFile } from "../canonical-track";
import { loadCanonicalTrack, loadPublishContext, loadTrackForRow } from "../cleaning/load";
import { DEFAULT_PRIVACY_SETTINGS } from "../privacy/settings";
import { DEFAULT_ACTIVITY_SETTINGS } from "../cleaning/settings";
import type { RepublishDeps, SourceInput } from "../republish";
import type { ActivityRow } from "../db/schema";

const inner = unwrapTrackFile(new Uint8Array(fs.readFileSync(path.join(__dirname, "fixtures", "sample-gps.fit.gz"))), "sample-gps.fit.gz").bytes;
const sha = sha256Hex(inner);

function fakeRow(over: Partial<ActivityRow> = {}): ActivityRow {
  return {
    id: 7, name: "run", sportType: "Run", startDateUtc: new Date(), localDate: "2026-01-01", localTime: "08:00",
    utcOffsetMin: 0, distanceM: 0, movingTimeS: 0, elapsedTimeS: 0, elevGainM: 0, avgSpeedMs: 0, maxSpeedMs: 0,
    avgHr: null, maxHr: null, avgCadence: null, avgWatts: null, maxWatts: null, kilojoules: null, description: null,
    sufferScore: null, gear: null, polyline: null, cardPolyline: null, bounds: null, trimStartM: 0, trimEndM: 0,
    fitBlobUrl: null, fitBlobPathname: null, fitSha256: null, fileType: "fit", source: "upload", externalId: null,
    dedupeKey: "k", hidden: false, processingVersion: 3, publishedInputsHash: null, canonicalTrackKey: null,
    mapHidden: false, hrHidden: false, publishedLocalTime: null, publishedStartUtc: null, fogEvents: null,
    fogShapes: null, trackBbox: null, needsRepublish: false, republishAttemptedAt: null, staleMarkedAt: null, legacyRoute: null, rawStats: null, hrZonesS: null, splitFromId: null,
    createdAt: new Date(), updatedAt: new Date(), ...over,
  };
}

const src = (over: Partial<SourceInput>): SourceInput => ({ id: 1, kind: "device-file", provider: "upload", externalId: null, rawSha256: sha, ...over });

let rows: Map<number, ActivityRow>;
let sources: Map<number, SourceInput[]>;
let raw: Map<string, Uint8Array>;
let deps: RepublishDeps;
const never = async () => {
  throw new Error("load must never write");
};

beforeEach(() => {
  rows = new Map([[7, fakeRow()], [8, fakeRow({ id: 8 })]]);
  sources = new Map([[7, [src({})]], [8, [src({ id: 2 })]]]);
  raw = new Map([[sha, inner]]);
  deps = {
    loadActivity: async (id) => rows.get(id) ?? null,
    loadSources: async (id) => sources.get(id) ?? [],
    loadEdits: async () => [],
    loadZones: async () => [
      { id: 1, polygon: [[[8.5, 47.3], [8.6, 47.3], [8.6, 47.4], [8.5, 47.3]]] },
      { id: 2, polygon: [[[100, 10], [100.1, 10], [100.1, 10.1], [100, 10]]] },
    ],
    loadRaw: async (s) => raw.get(s) ?? null,
    storeDerived: never,
    writeColumns: never,
  };
});

describe("loadCanonicalTrack", () => {
  it("builds the untouched canonical track exactly like republish", async () => {
    const res = await loadCanonicalTrack(7, deps);
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    const expected = canonicalFromDeviceFile(inner, `${sha}.fit`, sha);
    expect(res.track).toEqual(expected);
    expect(res.ref).toEqual({ kind: "device-file", sha256: sha, detailSha256: null });
  });

  it("not-found, no-track and unavailable", async () => {
    expect((await loadCanonicalTrack(99, deps)).status).toBe("not-found");
    sources.set(7, []);
    expect((await loadCanonicalTrack(7, deps)).status).toBe("no-track");
    sources.set(7, [src({ rawSha256: "f".repeat(64) })]);
    expect((await loadCanonicalTrack(7, deps)).status).toBe("unavailable");
  });

  it("never falls back past an unreadable better source", async () => {
    // first-attached device file unreadable, a later readable one exists
    sources.set(7, [src({ id: 1, rawSha256: "f".repeat(64) }), src({ id: 2 })]);
    const res = await loadTrackForRow(rows.get(7)!, deps);
    expect(res.status).toBe("unavailable");
  });
});

describe("loadPublishContext", () => {
  it("settings default, merged tracks loaded, only relevant zones", async () => {
    const res = await loadCanonicalTrack(7, deps);
    if (res.status !== "ok") throw new Error("no track");
    const ctx = await loadPublishContext(rows.get(7)!, res.track, [{ id: 3, kind: "merge", params: { withActivityId: 8 } }], deps);
    if (ctx === "unavailable") throw new Error("unavailable");
    expect(ctx.settings).toEqual(DEFAULT_PRIVACY_SETTINGS);
    expect(ctx.activity).toEqual(DEFAULT_ACTIVITY_SETTINGS);
    expect(ctx.merged).toHaveLength(1);
    expect(ctx.sportType).toBe("Run");
    expect(ctx.zones.map((z) => z.id)).not.toContain(2);
  });

  it("an unreadable merged track is reported, not skipped", async () => {
    sources.set(8, [src({ id: 2, rawSha256: "e".repeat(64) })]);
    const res = await loadCanonicalTrack(7, deps);
    if (res.status !== "ok") throw new Error("no track");
    expect(await loadPublishContext(rows.get(7)!, res.track, [{ id: 3, kind: "merge", params: { withActivityId: 8 } }], deps)).toBe("unavailable");
  });

  it("uses provided settings loaders", async () => {
    const res = await loadCanonicalTrack(7, deps);
    if (res.status !== "ok") throw new Error("no track");
    const settings = { ...DEFAULT_PRIVACY_SETTINGS, coarsenStartMin: 15 };
    const activity = { ...DEFAULT_ACTIVITY_SETTINGS, hrMaxBpm: 200 };
    const ctx = await loadPublishContext(rows.get(7)!, res.track, [], { ...deps, loadSettings: async () => settings, loadActivitySettings: async () => activity });
    expect(ctx).toMatchObject({ settings, activity, merged: [] });
  });
});
