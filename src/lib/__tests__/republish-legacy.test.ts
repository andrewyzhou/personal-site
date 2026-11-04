import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { getTableColumns } from "drizzle-orm";
import { parseTrackFile, unwrapTrackFile } from "../fit";
import { computePublished } from "../activities";
import { sha256Hex } from "../raw-store";
import { republish } from "../republish";
import { activities } from "../db/schema";
import {
  LEGACY_ACTIVITY_COLUMN_NAMES,
  emptySummary,
  formatValue,
  legacyActivityColumns,
  legacyDeps,
  legacyEdits,
  legacySources,
  recordError,
  recordResult,
  toActivityRow,
  type LegacyActivityRow,
} from "../republish-legacy";

const fixture = (name: string) => new Uint8Array(fs.readFileSync(path.join(__dirname, "fixtures", name)));
const inner = unwrapTrackFile(fixture("sample-gps.fit.gz"), "sample-gps.fit.gz").bytes;
const innerSha = sha256Hex(inner);

function legacyRow(over: Partial<LegacyActivityRow> = {}): LegacyActivityRow {
  return {
    id: 7, name: "run", sportType: "Run", startDateUtc: new Date("2026-01-01T00:00:00Z"),
    localDate: "2026-01-01", localTime: "00:00", utcOffsetMin: 0,
    distanceM: 0, movingTimeS: 0, elapsedTimeS: 0, elevGainM: 0, avgSpeedMs: 0, maxSpeedMs: 0,
    avgHr: null, maxHr: null, avgCadence: null, avgWatts: null, maxWatts: null, kilojoules: null,
    description: null, sufferScore: null, gear: null,
    polyline: null, cardPolyline: null, bounds: null, trimStartM: 0, trimEndM: 0,
    fitBlobUrl: null, fitBlobPathname: null, fitSha256: null, fileType: null,
    source: "strava-archive", externalId: "123", dedupeKey: "k", hidden: false,
    createdAt: new Date("2026-01-02T00:00:00Z"), updatedAt: new Date("2026-01-02T00:00:00Z"),
    ...over,
  };
}

// a row exactly as the legacy pipeline (import-strava-archive / upload) wrote it
function legacyPublishedRow(trimStartM: number, trimEndM: number): LegacyActivityRow {
  const parsed = parseTrackFile(inner, "x.fit");
  const pub = computePublished(parsed, trimStartM, trimEndM);
  return legacyRow({
    ...pub.stats,
    kilojoules: parsed.kilojoules,
    polyline: pub.polyline,
    cardPolyline: pub.cardPolyline,
    bounds: pub.bounds,
    trimStartM: pub.trimStartM,
    trimEndM: pub.trimEndM,
    fitSha256: innerSha,
    fitBlobPathname: `activities/fit/2026/${innerSha}.fit`,
    fileType: "fit",
  });
}

describe("legacy column list", () => {
  it("is the schema minus the three v2 columns", () => {
    const all = getTableColumns(activities);
    const legacy = legacyActivityColumns();
    expect(Object.keys(legacy)).toHaveLength(Object.keys(all).length - 3);
    expect(legacy).not.toHaveProperty("processingVersion");
    expect(legacy).not.toHaveProperty("publishedInputsHash");
    expect(legacy).not.toHaveProperty("canonicalTrackKey");
    expect(Object.values(legacy).map((c) => c.name).sort()).toEqual([...LEGACY_ACTIVITY_COLUMN_NAMES].sort());
  });
});

describe("backfill synthesis (mirrors 0003)", () => {
  it("device-file source with the fit sha, summary otherwise", () => {
    expect(legacySources(legacyRow({ fitSha256: innerSha }))).toEqual([
      { id: 1, provider: "strava", externalId: "123", kind: "device-file", rawSha256: innerSha },
    ]);
    expect(legacySources(legacyRow({ source: "upload", externalId: null }))).toEqual([
      { id: 1, provider: "upload", externalId: null, kind: "summary", rawSha256: null },
    ]);
  });

  it("trim edit when a polyline or an original exists, deliberate zeros included", () => {
    expect(legacyEdits(legacyRow({ polyline: null, trimStartM: 200, trimEndM: 200 }))).toEqual([]);
    // gps-less original that the legacy import still trimmed
    expect(legacyEdits(legacyRow({ polyline: null, fitSha256: innerSha, trimStartM: 200, trimEndM: 200 }))).toEqual([
      { id: 1, kind: "trim", params: { startM: 200, endM: 200 } },
    ]);
    expect(legacyEdits(legacyRow({ polyline: "abc", trimStartM: 0, trimEndM: 0 }))).toEqual([
      { id: 1, kind: "trim", params: { startM: 0, endM: 0 } },
    ]);
  });

  it("rows look never-republished", () => {
    const r = toActivityRow(legacyRow());
    expect(r.processingVersion).toBe(0);
    expect(r.publishedInputsHash).toBeNull();
    expect(r.canonicalTrackKey).toBeNull();
  });
});

describe("republish with legacy deps", () => {
  const depsFor = (row: LegacyActivityRow) =>
    legacyDeps({
      loadLegacyRow: async (id) => (id === row.id ? row : null),
      loadRaw: async (sha) => (sha === innerSha ? inner : null),
    });

  for (const [start, end] of [[200, 200], [0, 0], [150, 400]] as const) {
    it(`reproduces the legacy output exactly (trim ${start}/${end})`, async () => {
      const row = legacyPublishedRow(start, end);
      const res = await republish(row.id, { dryRun: true, deps: depsFor(row) });
      expect(res.status).toBe("would-publish");
      if (res.status === "would-publish") {
        expect(res.track.kind).toBe("device-file");
        expect(res.changed).toEqual([]);
      }
    });
  }

  it("csv-only rows have no source", async () => {
    const row = legacyRow({ source: "manual" });
    const res = await republish(row.id, { dryRun: true, deps: depsFor(row) });
    expect(res.status).toBe("no-source");
  });

  it("a missing original falls through to no-source", async () => {
    const row = legacyRow({ fitSha256: "f".repeat(64), polyline: "abc" });
    const res = await republish(row.id, { dryRun: true, deps: depsFor(row) });
    expect(res.status).toBe("no-source");
  });

  it("not-found for unknown ids", async () => {
    const res = await republish(999, { dryRun: true, deps: depsFor(legacyRow()) });
    expect(res.status).toBe("not-found");
  });

  it("refuses to write even without dryRun", async () => {
    const row = legacyPublishedRow(200, 200);
    await expect(republish(row.id, { deps: depsFor(row) })).rejects.toThrow(/read-only/);
  });
});

describe("change summary", () => {
  it("counts statuses, changed columns and examples", async () => {
    const row = legacyPublishedRow(200, 200);
    const tampered = { ...row, distanceM: row.distanceM + 50 };
    const deps = legacyDeps({ loadLegacyRow: async () => tampered, loadRaw: async () => inner });
    const res = await republish(row.id, { dryRun: true, deps });
    const s = emptySummary();
    recordResult(s, res, toActivityRow(tampered));
    recordResult(s, { status: "no-source", id: 2, hash: "h" }, null);
    recordError(s, 3, new Error("boom"));
    expect(s.statuses).toEqual({ "would-publish": 1, "no-source": 1, error: 1 });
    expect(s.changedActivities).toBe(1);
    expect(s.byTrackKind).toEqual({ "device-file": 1 });
    expect(Object.keys(s.columns)).toEqual(["distanceM"]);
    expect(s.columns.distanceM.examples[0]).toEqual({
      id: 7,
      old: formatValue(tampered.distanceM),
      new: formatValue(row.distanceM),
    });
    expect(s.errors).toEqual([{ id: 3, error: "boom" }]);
  });

  it("formats values compactly", () => {
    expect(formatValue(null)).toBe("null");
    expect(formatValue(12)).toBe("12");
    expect(formatValue(1.23456789)).toBe("1.2346");
    expect(formatValue("short")).toBe('"short"');
    expect(formatValue("x".repeat(40))).toBe(`"${"x".repeat(12)}…" (40 chars)`);
    expect(formatValue({ minLat: 1.123456789 })).toBe('{"minLat":1.12346}');
  });
});
