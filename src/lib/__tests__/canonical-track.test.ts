import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { gunzipSync, gzipSync } from "fflate";
import { parseTrackFile } from "../fit";
import { encodePolyline } from "../polyline";
import { sha256Hex } from "../raw-store";
import {
  CANONICAL_FORMAT_VERSION,
  TRACK_SOURCE_PRECEDENCE,
  canonicalFromDeviceFile,
  canonicalFromStravaPolyline,
  canonicalFromStravaStreams,
  canonicalToParsed,
  canonicalTrackKey,
  deserializeCanonical,
  hasGps,
  normalizeSamples,
  normalizeStravaStreams,
  serializeCanonical,
} from "../canonical-track";
import type { TrackRecord } from "../geo";

const fixture = (name: string) => new Uint8Array(fs.readFileSync(path.join(__dirname, "fixtures", name)));

const rec = (t: number, extra: Partial<TrackRecord> = {}): TrackRecord => ({
  t, lat: 37.87, lng: -122.26, ele: null, hr: null, cadence: null, watts: null, speed: null, ...extra,
});

describe("normalizeSamples", () => {
  it("snaps to whole seconds and keeps the last sample per second", () => {
    const c = normalizeSamples([rec(0, { hr: 100 }), rec(0.4, { hr: 101 }), rec(1.6, { hr: 102 }), rec(2.2, { hr: 103 })], [0, 1, 2, 3]);
    expect(c.t).toEqual([0, 2]);
    expect(c.hr).toEqual([101, 103]);
    expect(c.dist).toEqual([1, 3]);
  });

  it("sorts out-of-order samples and re-zeroes time", () => {
    const c = normalizeSamples([rec(5), rec(3), rec(4)], [2, 0, 1]);
    expect(c.t).toEqual([0, 1, 2]);
    expect(c.dist).toEqual([0, 1, 2]);
  });

  it("drops half-positions and non-finite values", () => {
    const c = normalizeSamples([rec(0, { lng: null }), rec(1, { hr: NaN, ele: Infinity })], [0, 0]);
    expect(c.lat[0]).toBeNull();
    expect(c.lng[0]).toBeNull();
    expect(c.hr[1]).toBeNull();
    expect(c.ele[1]).toBeNull();
  });

  it("falls back to haversine when the distance channel isn't monotonic", () => {
    const c = normalizeSamples([rec(0), rec(1, { lat: 37.88 })], [500, 10]);
    expect(c.dist[0]).toBe(0);
    expect(c.dist[1]).toBeGreaterThan(1000);
  });
});

describe("device file builder", () => {
  const bytes = fixture("sample-gps.fit.gz");
  const track = canonicalFromDeviceFile(bytes, "sample-gps.fit.gz");
  const parsed = parseTrackFile(bytes, "sample-gps.fit.gz");

  it("records its source and version", () => {
    expect(track.v).toBe(CANONICAL_FORMAT_VERSION);
    expect(track.source).toEqual({ kind: "device-file", sha256: sha256Hex(bytes), detailSha256: null, fileType: "fit" });
    expect(track.startEpochMs).toBe(parsed.startDateUtc.getTime());
    expect(track.session).toEqual(parsed.sessionStats);
    expect(hasGps(track)).toBe(true);
  });

  it("is columnar with aligned columns and whole-second, increasing time", () => {
    const n = track.columns.t.length;
    for (const col of Object.values(track.columns)) expect(col).toHaveLength(n);
    for (let i = 1; i < n; i++) expect(track.columns.t[i]).toBeGreaterThan(track.columns.t[i - 1]);
    expect(track.columns.t.every(Number.isInteger)).toBe(true);
  });

  it("is lossless for 1 hz device data (round trip to parsed records)", () => {
    const back = canonicalToParsed(track);
    expect(back.records.length).toBe(parsed.records.length);
    expect(back.cumDist).toEqual(parsed.cumDist);
    expect(back.records[10]).toEqual(parsed.records[10]);
  });

  it("serializes deterministically and round-trips", () => {
    const a = serializeCanonical(track);
    const b = serializeCanonical(canonicalFromDeviceFile(bytes, "sample-gps.fit.gz"));
    expect(sha256Hex(a)).toBe(sha256Hex(b));
    expect(deserializeCanonical(a)).toEqual(track);
    expect(canonicalTrackKey(a)).toBe(`derived/canonical/v1/${sha256Hex(a)}.json.gz`);
    // gzip header mtime pinned to zero
    expect(Array.from(a.slice(4, 8))).toEqual([0, 0, 0, 0]);
    expect(JSON.parse(new TextDecoder().decode(gunzipSync(a))).format).toBe("canonical-track");
  });

  it("rejects other versions on read", () => {
    const wrong = new TextEncoder().encode(JSON.stringify({ ...track, v: 99 }));
    expect(() => deserializeCanonical(gzipSync(wrong))).toThrow(/version/);
  });
});

const detail = {
  id: 42,
  name: "lunch run",
  sport_type: "Run",
  start_date: "2026-10-01T19:00:00Z",
  utc_offset: -25200,
  distance: 2000,
  moving_time: 600,
  elapsed_time: 620,
  total_elevation_gain: 5,
  average_speed: 3.33,
  max_speed: 4,
  has_heartrate: true,
  average_heartrate: 150,
  max_heartrate: 170,
  kilojoules: 300,
  map: { summary_polyline: encodePolyline([[37.87, -122.26], [37.875, -122.255], [37.88, -122.25]]) },
};

describe("strava streams builder", () => {
  const streams = {
    time: { data: [0, 1, 2, 3] },
    latlng: { data: [[37.87, -122.26], [37.8701, -122.2601], [37.8702, -122.2602], [37.8703, -122.2603]] },
    distance: { data: [0, 10, 20, 30] },
    heartrate: { data: [120, 121, 122, 123] },
    altitude: { data: [10, 11, 12, 13] },
  };

  it("builds from key_by_type streams + detail", () => {
    const t = canonicalFromStravaStreams(detail, streams, { streamsSha256: "a".repeat(64), detailSha256: "b".repeat(64) })!;
    expect(t.source).toEqual({ kind: "strava-streams", sha256: "a".repeat(64), detailSha256: "b".repeat(64), fileType: null });
    expect(t.utcOffsetMin).toBe(-420);
    expect(t.hasLocalTime).toBe(true);
    expect(t.columns.dist).toEqual([0, 10, 20, 30]);
    expect(t.columns.hr).toEqual([120, 121, 122, 123]);
    expect(t.session?.avgHr).toBe(150);
    expect(t.kilojoules).toBe(300);
  });

  it("accepts the array stream form identically", () => {
    const arrayForm = Object.entries(streams).map(([type, s]) => ({ type, data: s.data }));
    expect(normalizeStravaStreams(arrayForm)).toEqual(normalizeStravaStreams(streams));
  });

  it("returns null without a time stream", () => {
    expect(canonicalFromStravaStreams(detail, { latlng: streams.latlng }, { streamsSha256: "a".repeat(64), detailSha256: "b".repeat(64) })).toBeNull();
  });
});

describe("strava polyline builder", () => {
  it("spreads synthetic time over elapsed time and keeps summary stats", () => {
    const t = canonicalFromStravaPolyline(detail, "c".repeat(64))!;
    expect(t.syntheticTime).toBe(true);
    expect(t.source.kind).toBe("strava-polyline");
    expect(t.columns.t[0]).toBe(0);
    expect(t.columns.t[t.columns.t.length - 1]).toBe(620);
    expect(t.session?.distanceM).toBe(2000);
  });

  it("returns null without a polyline", () => {
    expect(canonicalFromStravaPolyline({ ...detail, map: null }, "c".repeat(64))).toBeNull();
  });
});

describe("precedence", () => {
  it("is device file > streams > polyline", () => {
    expect(TRACK_SOURCE_PRECEDENCE).toEqual(["device-file", "strava-streams", "strava-polyline"]);
  });
});
