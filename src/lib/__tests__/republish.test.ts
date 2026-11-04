import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parseTrackFile, unwrapTrackFile } from "../fit";
import { computePublished, DEFAULT_PRIVACY_TRIM_M } from "../activities";
import { sha256Hex } from "../raw-store";
import { canonicalFromDeviceFile, deserializeCanonical } from "../canonical-track";
import {
  PROCESSING_VERSION,
  activeEdits,
  computePublicColumns,
  diffColumns,
  inputsHash,
  republish,
  resolveOverrides,
  resolveTrim,
  stableStringify,
  trackCandidates,
  withLegacyTrim,
  type EditInput,
  type RepublishDeps,
  type SourceInput,
} from "../republish";
import type { ActivityRow } from "../db/schema";

const fixture = (name: string) => new Uint8Array(fs.readFileSync(path.join(__dirname, "fixtures", name)));
const gz = fixture("sample-gps.fit.gz");
// legacy originals were stored unwrapped, keyed by the inner sha
const inner = unwrapTrackFile(gz, "sample-gps.fit.gz").bytes;
const innerSha = sha256Hex(inner);

const src = (over: Partial<SourceInput>): SourceInput => ({
  id: 1, kind: "device-file", provider: "strava", externalId: "1", rawSha256: innerSha, ...over,
});

describe("trackCandidates", () => {
  it("orders device file > streams > polyline; first-attached device file wins", () => {
    const c = trackCandidates([
      src({ id: 1, kind: "strava-detail", rawSha256: "d".repeat(64) }),
      src({ id: 2, kind: "strava-streams", rawSha256: "s".repeat(64) }),
      src({ id: 3, kind: "device-file", rawSha256: "a".repeat(64) }),
      src({ id: 4, kind: "device-file", rawSha256: "b".repeat(64) }),
      src({ id: 5, kind: "summary", rawSha256: null }),
    ]);
    expect(c.map((r) => [r.kind, r.sha256[0]])).toEqual([
      ["device-file", "a"],
      ["device-file", "b"],
      ["strava-streams", "s"],
      ["strava-polyline", "d"],
    ]);
    expect(c[2].detailSha256).toBe("d".repeat(64));
  });

  it("needs a detail for streams/polyline and a raw sha for anything", () => {
    expect(trackCandidates([src({ kind: "strava-streams", rawSha256: "s".repeat(64) }), src({ id: 2, rawSha256: null })])).toEqual([]);
  });
});

describe("edits", () => {
  it("activeEdits drops reverted rows and orders by id", () => {
    const e = activeEdits([
      { id: 3, kind: "trim", params: {}, revertedAt: null },
      { id: 1, kind: "trim", params: {}, revertedAt: new Date() },
      { id: 2, kind: "override", params: {} },
    ]);
    expect(e.map((x) => x.id)).toEqual([2, 3]);
  });

  it("resolveTrim: latest trim edit wins, else default for gps, else 0", () => {
    const edits: EditInput[] = [
      { id: 1, kind: "trim", params: { startM: 100, endM: 100 } },
      { id: 2, kind: "trim", params: { startM: 0, endM: 50 } },
    ];
    expect(resolveTrim(edits, true)).toEqual({ startM: 0, endM: 50 });
    expect(resolveTrim([], true)).toEqual({ startM: DEFAULT_PRIVACY_TRIM_M, endM: DEFAULT_PRIVACY_TRIM_M });
    expect(resolveTrim([], false)).toEqual({ startM: 0, endM: 0 });
    expect(resolveTrim([{ id: 1, kind: "trim", params: { startM: -5, endM: "x" } }], true)).toEqual({ startM: 0, endM: 0 });
  });

  it("withLegacyTrim only applies to never-republished rows with a route or original", () => {
    const base = { processingVersion: 0, polyline: "p", fitSha256: null, trimStartM: 10, trimEndM: 20 };
    expect(withLegacyTrim(base, [])).toEqual([{ id: 0, kind: "trim", params: { startM: 10, endM: 20 } }]);
    expect(withLegacyTrim({ ...base, processingVersion: 1 }, [])).toEqual([]);
    expect(withLegacyTrim({ ...base, polyline: null }, [])).toEqual([]);
    const trim = { id: 3, kind: "trim", params: { startM: 0, endM: 0 } };
    expect(withLegacyTrim(base, [trim])).toEqual([trim]);
  });

  it("resolveOverrides whitelists fields and validates values", () => {
    const o = resolveOverrides([
      { id: 1, kind: "override", params: { distanceM: 5000, polyline: "evil", movingTimeS: 99.6 } },
      { id: 2, kind: "override", params: { distanceM: 5100, avgHr: null, maxSpeedMs: -1, elevGainM: "12" } },
    ]);
    expect(o).toEqual({ distanceM: 5100, movingTimeS: 100, avgHr: null });
  });
});

describe("inputsHash", () => {
  const track = { kind: "device-file" as const, sha256: innerSha, detailSha256: null };
  it("is stable under key order and edit order", () => {
    const a = inputsHash({ track, edits: [{ id: 2, kind: "trim", params: { startM: 1, endM: 2 } }, { id: 1, kind: "override", params: { a: 1, b: 2 } }], zones: [] });
    const b = inputsHash({ track, edits: [{ id: 1, kind: "override", params: { b: 2, a: 1 } }, { id: 2, kind: "trim", params: { endM: 2, startM: 1 } }], zones: [] });
    expect(a).toBe(b);
  });

  it("changes with any input", () => {
    const base = inputsHash({ track, edits: [], zones: [] });
    expect(inputsHash({ track: { ...track, sha256: "0".repeat(64) }, edits: [], zones: [] })).not.toBe(base);
    expect(inputsHash({ track, edits: [{ id: 1, kind: "trim", params: {} }], zones: [] })).not.toBe(base);
    expect(inputsHash({ track, edits: [], zones: [{ id: 1, polygon: [[[0, 0]]] }] })).not.toBe(base);
    expect(inputsHash({ track, edits: [], zones: [], processingVersion: PROCESSING_VERSION + 1 })).not.toBe(base);
    expect(inputsHash({ track: null, edits: [], zones: [] })).not.toBe(base);
  });

  it("stableStringify sorts keys recursively and drops undefined", () => {
    expect(stableStringify({ b: 1, a: { d: [1, { f: 1, e: 2 }], c: undefined } })).toBe('{"a":{"d":[1,{"e":2,"f":1}]},"b":1}');
  });
});

describe("computePublicColumns", () => {
  const track = canonicalFromDeviceFile(inner, "x.fit", innerSha);
  const parsed = parseTrackFile(inner, "x.fit");

  it("reproduces the legacy pipeline output for the same trim", () => {
    for (const [s, e] of [[0, 0], [200, 200], [50, 0]]) {
      const legacy = computePublished(parsed, s, e);
      const cols = computePublicColumns(track, [{ id: 1, kind: "trim", params: { startM: s, endM: e } }]);
      expect(cols).toEqual({
        ...legacy.stats,
        kilojoules: parsed.kilojoules,
        polyline: legacy.polyline,
        cardPolyline: legacy.cardPolyline,
        bounds: legacy.bounds,
        trimStartM: s,
        trimEndM: e,
        fogEvents: null,
        fogShapes: null,
      });
    }
  });

  it("applies the default trim without a trim edit (legacy ingest behavior)", () => {
    expect(computePublicColumns(track, []).trimStartM).toBe(DEFAULT_PRIVACY_TRIM_M);
  });

  it("is deterministic", () => {
    const edits: EditInput[] = [{ id: 1, kind: "trim", params: { startM: 120, endM: 80 } }];
    expect(stableStringify(computePublicColumns(track, edits))).toBe(stableStringify(computePublicColumns(canonicalFromDeviceFile(inner, "x.fit", innerSha), edits)));
  });

  it("applies overrides last", () => {
    const cols = computePublicColumns(track, [{ id: 1, kind: "override", params: { distanceM: 1234 } }]);
    expect(cols.distanceM).toBe(1234);
  });
});

describe("diffColumns", () => {
  it("ignores float noise and compares json columns structurally", () => {
    const track = canonicalFromDeviceFile(inner, "x.fit", innerSha);
    const cols = computePublicColumns(track, []);
    const row = { ...cols, distanceM: cols.distanceM * (1 + 1e-9), bounds: { ...cols.bounds! } } as unknown as ActivityRow;
    expect(diffColumns(row, cols)).toEqual([]);
    expect(diffColumns({ ...row, polyline: "x" }, cols)).toEqual(["polyline"]);
  });
});

// ---------------------------------------------------------------------------
// io orchestration with fake deps

function fakeRow(over: Partial<ActivityRow> = {}): ActivityRow {
  return {
    id: 7, name: "run", sportType: "Run", startDateUtc: new Date(), localDate: "2026-01-01", localTime: "08:00",
    utcOffsetMin: 0, distanceM: 0, movingTimeS: 0, elapsedTimeS: 0, elevGainM: 0, avgSpeedMs: 0, maxSpeedMs: 0,
    avgHr: null, maxHr: null, avgCadence: null, avgWatts: null, maxWatts: null, kilojoules: null, description: null,
    sufferScore: null, gear: null, polyline: null, cardPolyline: null, bounds: null, trimStartM: 0, trimEndM: 0,
    fitBlobUrl: null, fitBlobPathname: null, fitSha256: null, fileType: "fit", source: "upload", externalId: null,
    dedupeKey: "k", hidden: false, processingVersion: 0, publishedInputsHash: null, canonicalTrackKey: null,
    mapHidden: false, hrHidden: false, publishedLocalTime: null, publishedStartUtc: null, fogEvents: null,
    fogShapes: null, trackBbox: null, needsRepublish: false, republishAttemptedAt: null, staleMarkedAt: null, legacyRoute: null,
    createdAt: new Date(), updatedAt: new Date(), ...over,
  };
}

let row: ActivityRow;
let sources: SourceInput[];
let edits: EditInput[];
let raw: Map<string, Uint8Array>;
let derived: Map<string, Uint8Array>;
let writes: Record<string, unknown>[];
let deps: RepublishDeps;

beforeEach(() => {
  row = fakeRow();
  sources = [src({})];
  edits = [{ id: 1, kind: "trim", params: { startM: 200, endM: 200 } }];
  raw = new Map([[innerSha, inner]]);
  derived = new Map();
  writes = [];
  deps = {
    loadActivity: async (id) => (id === row.id ? row : null),
    loadSources: async () => sources,
    loadEdits: async () => edits,
    loadZones: async () => [],
    loadRaw: async (sha) => raw.get(sha) ?? null,
    storeDerived: async (key, bytes) => {
      derived.set(key, bytes);
      return true;
    },
    writeColumns: async (_id, values) => {
      writes.push(values);
      Object.assign(row, values);
    },
  };
});

describe("republish", () => {
  it("publishes columns + bookkeeping and stores the canonical track", async () => {
    const res = await republish(7, { deps });
    expect(res.status).toBe("published");
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ processingVersion: PROCESSING_VERSION, trimStartM: 200, trimEndM: 200 });
    expect(writes[0].publishedInputsHash).toMatch(/^[0-9a-f]{64}$/);
    const key = writes[0].canonicalTrackKey as string;
    expect(deserializeCanonical(derived.get(key)!).source.sha256).toBe(innerSha);
  });

  it("is idempotent: a second run is fresh and writes nothing", async () => {
    await republish(7, { deps });
    const res = await republish(7, { deps });
    expect(res.status).toBe("fresh");
    expect(writes).toHaveLength(1);
  });

  it("force rebuilds to identical output (determinism)", async () => {
    await republish(7, { deps });
    await republish(7, { deps, force: true });
    expect(writes).toHaveLength(2);
    const strip = (w: Record<string, unknown>) => ({ ...w, updatedAt: null });
    expect(stableStringify(strip(writes[1]))).toBe(stableStringify(strip(writes[0])));
  });

  it("goes stale when an edit changes", async () => {
    await republish(7, { deps });
    edits = [...edits, { id: 2, kind: "trim", params: { startM: 0, endM: 0 } }];
    const res = await republish(7, { deps });
    expect(res.status).toBe("published");
    expect(row.trimStartM).toBe(0);
  });

  it("dry run computes the diff and writes nothing", async () => {
    const res = await republish(7, { deps, dryRun: true });
    expect(res.status).toBe("would-publish");
    if (res.status === "would-publish") expect(res.changed).toContain("polyline");
    expect(writes).toHaveLength(0);
    expect(derived.size).toBe(0);
  });

  it("never downgrades past a source whose bytes are missing", async () => {
    const missing = "e".repeat(64);
    sources = [src({ id: 1, rawSha256: missing }), src({ id: 2 }), src({ id: 3, kind: "strava-detail", rawSha256: "d".repeat(64) })];
    const res = await republish(7, { deps });
    expect(res.status).toBe("source-unavailable");
    if (res.status === "source-unavailable") expect(res.track.sha256).toBe(missing);
    expect(writes).toHaveLength(0);
  });

  it("a later device-file copy does not displace the first original", async () => {
    sources = [src({ id: 1 }), src({ id: 9, rawSha256: sha256Hex(gz) })];
    raw.set(sha256Hex(gz), gz);
    const res = await republish(7, { deps });
    if (res.status === "published") expect(res.track.sha256).toBe(innerSha);
    else throw new Error(res.status);
  });

  it("keeps the legacy trim of a never-republished row without a trim edit, and persists it", async () => {
    edits = [];
    row = fakeRow({ polyline: "abc", trimStartM: 50, trimEndM: 0 });
    const recorded: unknown[] = [];
    deps.recordEdit = async (_id, kind, params) => {
      recorded.push({ kind, params });
      edits = [{ id: 11, kind, params }];
      return 11;
    };
    await republish(7, { deps });
    expect(recorded).toEqual([{ kind: "trim", params: { startM: 50, endM: 0 } }]);
    expect(row.trimStartM).toBe(50);
    // second run sees the persisted edit and is fresh
    expect((await republish(7, { deps })).status).toBe("fresh");
  });

  it("leaves route/stat columns of trackless activities untouched", async () => {
    sources = [src({ kind: "summary", rawSha256: null })];
    const res = await republish(7, { deps });
    expect(res.status).toBe("no-source");
    expect(writes).toHaveLength(1);
    expect(Object.keys(writes[0]).sort()).toEqual(["needsRepublish", "processingVersion", "publishedInputsHash", "publishedLocalTime", "publishedStartUtc", "updatedAt"]);
  });

  it("skips a device file with no timed points (empty gpx shell)", async () => {
    const shell = new TextEncoder().encode('<?xml version="1.0"?><gpx version="1.1"><trk><name>x</name></trk></gpx>');
    const shellSha = sha256Hex(shell);
    raw.set(shellSha, shell);
    sources = [src({ id: 2, rawSha256: shellSha })];
    expect((await republish(7, { deps })).status).toBe("no-source");
    expect(writes.every((w) => !("polyline" in w))).toBe(true);
  });

  it("reports not-found", async () => {
    expect((await republish(99, { deps })).status).toBe("not-found");
  });

  it("records a null canonical key when there is no private store", async () => {
    deps.storeDerived = async () => false;
    await republish(7, { deps });
    expect(writes[0].canonicalTrackKey).toBeNull();
  });
});
