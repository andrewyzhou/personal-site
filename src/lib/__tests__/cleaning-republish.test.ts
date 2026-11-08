import { describe, it, expect, vi, beforeEach } from "vitest";
import { CANONICAL_FORMAT_VERSION, type CanonicalTrack } from "../canonical-track";
import type { ActivityRow } from "../db/schema";
import type { Suggestion } from "../cleaning/types";

// device files resolve to synthetic tracks by sha (no fit parsing here)
const { tracks, detected } = vi.hoisted(() => ({
  tracks: new Map<string, CanonicalTrack>(),
  detected: { value: [] as Suggestion[] },
}));
vi.mock("../canonical-track", async (orig) => ({
  ...(await orig<typeof import("../canonical-track")>()),
  canonicalFromDeviceFile: (_b: Uint8Array, _f: string, sha: string) => {
    const t = tracks.get(sha);
    if (!t) throw new Error(`no track ${sha}`);
    return t;
  },
}));
vi.mock("../cleaning/detect", () => ({ detectSuggestions: () => detected.value }));

import { republish, type EditInput, type RepublishDeps } from "../republish";
import { decodeMultiPolyline } from "../polyline";
import { DEFAULT_ACTIVITY_SETTINGS } from "../cleaning/settings";

function makeTrack(n: number, startEpochMs: number, sha: string, lngStart = -122.3): CanonicalTrack {
  const cols = { t: [] as number[], lat: [] as (number | null)[], lng: [] as (number | null)[], speed: [] as (number | null)[], dist: [] as number[] };
  for (let i = 0; i < n; i++) {
    cols.t.push(i);
    cols.lat.push(37.8);
    cols.lng.push(lngStart + (i * 3) / 88000);
    cols.speed.push(3);
    cols.dist.push(i * 3);
  }
  const nul = cols.t.map(() => null);
  return {
    format: "canonical-track", v: CANONICAL_FORMAT_VERSION,
    source: { kind: "device-file", sha256: sha, detailSha256: null, fileType: "fit" },
    sportType: "Run", startEpochMs, utcOffsetMin: 0, hasLocalTime: true, syntheticTime: false,
    session: { distanceM: (n - 1) * 3, movingTimeS: n - 1, elapsedTimeS: n - 1, elevGainM: 0, avgSpeedMs: 3, maxSpeedMs: 3, avgHr: null, maxHr: null, avgCadence: null, avgWatts: null, maxWatts: null },
    kilojoules: null, suggestedName: "run",
    columns: { ...cols, ele: nul, hr: nul, cadence: nul, watts: nul },
  };
}

function row(id: number, startMs: number): ActivityRow {
  return {
    id, name: "run", sportType: "Run", startDateUtc: new Date(startMs), localDate: "2026-10-01", localTime: "15:00",
    utcOffsetMin: 0, distanceM: 0, movingTimeS: 0, elapsedTimeS: 0, elevGainM: 0, avgSpeedMs: 0, maxSpeedMs: 0,
    avgHr: null, maxHr: null, avgCadence: null, avgWatts: null, maxWatts: null, kilojoules: null, description: null,
    sufferScore: null, gear: null, polyline: null, cardPolyline: null, bounds: null, trimStartM: 0, trimEndM: 0,
    fitBlobUrl: null, fitBlobPathname: null, fitSha256: null, fileType: "fit", source: "upload", externalId: null,
    dedupeKey: `k${id}`, hidden: false, processingVersion: 0, publishedInputsHash: null, canonicalTrackKey: null,
    mapHidden: false, hrHidden: false, publishedLocalTime: null, publishedStartUtc: null, fogEvents: null, fogShapes: null,
    trackBbox: null, needsRepublish: false, staleMarkedAt: null, legacyRoute: null, rawStats: null, hrZonesS: null,
    splitFromId: null, republishAttemptedAt: null, metaEditedAt: null, upstreamMeta: null, createdAt: new Date(), updatedAt: new Date(),
  };
}

const T0 = Date.UTC(2026, 9, 1, 15);
const shaA = "a".repeat(64);
const shaB = "b".repeat(64);
let rows: Map<number, ActivityRow>;
let edits: Map<number, EditInput[]>;
let writes: { id: number; values: Record<string, unknown> }[];
let recorded: { id: number; suggestions: Suggestion[]; min: number | null }[];
let autoApplyResult: EditInput[];

function deps(over: Partial<RepublishDeps> = {}): RepublishDeps {
  return {
    loadActivity: async (id) => rows.get(id) ?? null,
    loadSources: async (id) => [{ id, kind: "device-file", provider: "upload", externalId: null, rawSha256: id === 1 ? shaA : shaB }],
    loadEdits: async (id) => edits.get(id) ?? [],
    loadZones: async () => [],
    loadRaw: async () => new Uint8Array([1]),
    storeDerived: async () => false,
    writeColumns: async (id, values) => {
      writes.push({ id, values });
      Object.assign(rows.get(id)!, values);
    },
    activitySettingsOverride: async () => ({ ...DEFAULT_ACTIVITY_SETTINGS, autoApply: { enabled: true, minConfidence: 0.9 } }),
    recordSuggestions: async (id, suggestions, min) => {
      recorded.push({ id, suggestions, min });
      return autoApplyResult;
    },
    ...over,
  };
}

beforeEach(() => {
  tracks.clear();
  tracks.set(shaA, makeTrack(600, T0, shaA));
  tracks.set(shaB, makeTrack(300, T0 + 3600_000, shaB, -122.25));
  rows = new Map([[1, row(1, T0)], [2, row(2, T0 + 3600_000)]]);
  edits = new Map([[1, [{ id: 1, kind: "trim", params: { startM: 0, endM: 0 } }]]]);
  writes = [];
  recorded = [];
  autoApplyResult = [];
  detected.value = [];
});

describe("republish with cleaning", () => {
  it("merge: publishes both tracks as separate segments with summed distance", async () => {
    edits.set(1, [...edits.get(1)!, { id: 2, kind: "merge", params: { withActivityId: 2 } }]);
    const res = await republish(1, { deps: deps() });
    expect(res.status).toBe("published");
    const a = rows.get(1)!;
    expect(decodeMultiPolyline(a.polyline!)).toHaveLength(2);
    expect(a.distanceM).toBeCloseTo(599 * 3 + 299 * 3, 6);
    // a changed merged source makes the target stale
    const h1 = a.publishedInputsHash;
    expect((await republish(1, { deps: deps() })).status).toBe("fresh");
    tracks.set("c".repeat(64), makeTrack(300, T0 + 3600_000, "c".repeat(64)));
    const d = deps({ loadSources: async (id) => [{ id, kind: "device-file", provider: "upload", externalId: null, rawSha256: id === 1 ? shaA : "c".repeat(64) }] });
    expect((await republish(1, { deps: d })).status).toBe("published");
    expect(rows.get(1)!.publishedInputsHash).not.toBe(h1);
  });

  it("records detector output and publishes with auto-applied edits", async () => {
    detected.value = [{ kind: "crop-tail", confidence: 0.95, edit: { kind: "crop", params: { startS: null, endS: 300 } }, summary: "watch kept recording", range: { fromS: 300, toS: 599 } }];
    autoApplyResult = [{ id: 77, kind: "crop", params: { startS: null, endS: 300 } }];
    await republish(1, { deps: deps() });
    expect(recorded[0]).toMatchObject({ id: 1, min: 0.9 });
    expect(rows.get(1)!.elapsedTimeS).toBe(300);
    expect(rows.get(1)!.rawStats!.elapsedTimeS).toBe(599);
  });

  it("drops suggestions outside the crop in effect; no auto-apply for sports without limits", async () => {
    edits.set(1, [...edits.get(1)!, { id: 3, kind: "crop", params: { startS: 0, endS: 200 } }]);
    detected.value = [
      { kind: "crop-tail", confidence: 0.95, edit: { kind: "crop", params: { startS: null, endS: 400 } }, summary: "tail", range: { fromS: 400, toS: 599 } },
      { kind: "idle", confidence: 0.8, edit: null, summary: "stop", range: { fromS: 50, toS: 120 } },
    ];
    await republish(1, { deps: deps() });
    expect(recorded[0].suggestions.map((s) => s.kind)).toEqual(["idle"]);
    expect(recorded[0].min).toBe(0.9);
    rows.get(1)!.sportType = "Kitesurf";
    await republish(1, { deps: deps(), force: true });
    expect(recorded[1].min).toBeNull();
  });

  it("an absorbed activity's republish marks its merge target stale", async () => {
    edits.set(2, [{ id: 5, kind: "merged-into", params: { intoActivityId: 1, wasHidden: false } }]);
    const marked: number[] = [];
    await republish(2, { deps: deps({ markStale: async (id) => void marked.push(id) }) });
    expect(marked).toEqual([1]);
  });

  it("the absorbed activity's own crop applies to its part of a merge", async () => {
    edits.set(1, [...edits.get(1)!, { id: 2, kind: "merge", params: { withActivityId: 2 } }]);
    edits.set(2, [{ id: 8, kind: "crop", params: { startS: 0, endS: 99 } }, { id: 9, kind: "merged-into", params: { intoActivityId: 1, wasHidden: false } }]);
    await republish(1, { deps: deps() });
    expect(rows.get(1)!.distanceM).toBeCloseTo(599 * 3 + 99 * 3, 6);
  });

  it("dry runs never record suggestions", async () => {
    detected.value = [{ kind: "idle", confidence: 1, edit: null, summary: "stop", range: { fromS: 1, toS: 100 } }];
    await republish(1, { deps: deps(), dryRun: true });
    expect(recorded).toHaveLength(0);
    expect(writes).toHaveLength(0);
  });

  it("an unreadable merged track waits instead of publishing half", async () => {
    edits.set(1, [...edits.get(1)!, { id: 2, kind: "merge", params: { withActivityId: 2 } }]);
    const d = deps({ loadRaw: async (sha) => (sha === shaB ? null : new Uint8Array([1])) });
    expect((await republish(1, { deps: d })).status).toBe("source-unavailable");
    expect(writes.every((w) => !("distanceM" in w.values))).toBe(true);
  });
});
