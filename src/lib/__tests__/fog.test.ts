import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  applyFog,
  boundsIntersect,
  isValidPolygon,
  pointInPolygon,
  polygonBounds,
  publicZoneShape,
  relevantZones,
  segmentTouchesPolygon,
  type FogSample,
} from "../privacy/fog";
import { coarsenStart, normalizeSettings, publishedDistance, DEFAULT_PRIVACY_SETTINGS } from "../privacy/settings";
import { decodeMultiPolyline, decodePolyline, encodeMultiPolyline, encodePolyline } from "../polyline";
import { unwrapTrackFile } from "../fit";
import { sha256Hex } from "../raw-store";
import { canonicalFromDeviceFile } from "../canonical-track";
import { computePhotoPins, computePublicColumns, inputsHash, publishTrack, publishedStart, trackBounds } from "../republish";

// square zone [lng, lat] around a center, half-size in degrees
const square = (lat: number, lng: number, h: number): number[][][] => [
  [[lng - h, lat - h], [lng + h, lat - h], [lng + h, lat + h], [lng - h, lat + h], [lng - h, lat - h]],
];

describe("point in polygon", () => {
  const z = square(0, 0, 1);
  it("inside / outside / holes", () => {
    expect(pointInPolygon(0.5, 0.5, z)).toBe(true);
    expect(pointInPolygon(2, 0, z)).toBe(false);
    const withHole = [...z, ...square(0, 0, 0.2)];
    expect(pointInPolygon(0, 0, withHole)).toBe(false);
    expect(pointInPolygon(0.5, 0.5, withHole)).toBe(true);
  });

  it("segment crossing without endpoints inside", () => {
    expect(segmentTouchesPolygon([0, -2], [0, 2], z)).toBe(true);
    expect(segmentTouchesPolygon([2, -2], [2, 2], z)).toBe(false);
  });

  it("bounds + relevance", () => {
    expect(polygonBounds(z)).toEqual({ minLat: -1, minLng: -1, maxLat: 1, maxLng: 1 });
    expect(boundsIntersect({ minLat: 0, minLng: 0, maxLat: 2, maxLng: 2 }, polygonBounds(z)!)).toBe(true);
    const far = { id: 2, polygon: square(50, 50, 1) };
    expect(relevantZones([{ id: 1, polygon: z }, far], { minLat: 0, minLng: 0, maxLat: 0.1, maxLng: 0.1 }).map((x) => x.id)).toEqual([1]);
    expect(relevantZones([far], null)).toHaveLength(1);
  });

  it("validates polygons", () => {
    expect(isValidPolygon(z)).toBe(true);
    expect(isValidPolygon([[[0, 0], [1, 1]]])).toBe(false);
    expect(isValidPolygon([[[0, 0], [1, 1], [200, 0]]])).toBe(false);
    expect(isValidPolygon("x")).toBe(false);
  });

  it("public shape keeps the outer ring only, rounded", () => {
    const s = publicZoneShape([[[1.234567, 2.345678], [1, 2], [1, 3]], [[0, 0], [0, 1], [1, 1]]]);
    expect(s).toEqual([[[1.2346, 2.3457], [1, 2], [1, 3]]]);
  });
});

// a straight east-west line at lat 0, one sample per second, lng 0 → 0.01
const line: FogSample[] = Array.from({ length: 101 }, (_, i) => ({ lat: 0, lng: i * 0.0001, t: i * 10 }));

describe("applyFog", () => {
  it("is the identity without zones", () => {
    const r = applyFog(line, []);
    expect(r.segments).toEqual([line]);
    expect(r.events).toEqual([]);
  });

  it("drops in-zone samples, splits the route, and records an edge-anchored event", () => {
    const zone = { id: 7, polygon: square(0, 0.005, 0.00105) }; // lng 0.00395..0.00605
    const r = applyFog(line, [zone]);
    expect(r.segments).toHaveLength(2);
    for (const seg of r.segments) for (const s of seg) expect(pointInPolygon(s.lat, s.lng, zone.polygon)).toBe(false);
    expect(r.events).toHaveLength(1);
    expect(r.events[0].entry![1]).toBeCloseTo(38 * 0.0001, 10); // 15 m edge buffer
    expect(r.events[0].exit![1]).toBeCloseTo(62 * 0.0001, 10);
    expect(r.events[0].durationS % 60).toBe(0);
    expect(r.touchedZoneIds).toEqual([7]);
    expect(r.visibleDistanceM).toBeLessThan(applyFog(line, []).visibleDistanceM);
  });

  it("starting or ending in the fog leaves entry/exit null", () => {
    const zs = [{ id: 1, polygon: square(0, 0, 0.0015) }, { id: 2, polygon: square(0, 0.01, 0.0015) }];
    const r = applyFog(line, zs);
    expect(r.events[0].entry).toBeNull();
    expect(r.events[r.events.length - 1].exit).toBeNull();
    expect(r.segments).toHaveLength(1);
  });

  it("breaks the line where a straight segment would cross a zone between samples", () => {
    const sparse: FogSample[] = [{ lat: 0, lng: 0, t: 0 }, { lat: 0, lng: 0.01, t: 600 }];
    const r = applyFog(sparse, [{ id: 3, polygon: square(0, 0.005, 0.001) }]);
    expect(r.segments).toHaveLength(2);
    expect(r.events).toEqual([{ entry: [0, 0], exit: [0, 0.01], durationS: 600 }]);
  });
});

describe("multi-segment polyline", () => {
  it("one segment encodes like before; several round-trip", () => {
    const a: [number, number][] = [[1, 2], [1.1, 2.1]];
    const b: [number, number][] = [[3, 4], [3.1, 4.1]];
    expect(encodeMultiPolyline([a])).toBe(encodePolyline(a));
    const enc = encodeMultiPolyline([a, b, []]);
    expect(enc.split(" ")).toHaveLength(2);
    expect(decodeMultiPolyline(enc)).toEqual([decodePolyline(encodePolyline(a)), decodePolyline(encodePolyline(b))]);
  });
});

describe("settings", () => {
  it("normalizes junk to defaults and keeps valid values", () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_PRIVACY_SETTINGS);
    expect(normalizeSettings({ distance: { mode: "visible-only", roundToM: 500 }, coarsenStartMin: 15, defaultTrimM: 0 })).toEqual({
      distance: { mode: "visible-only", roundToM: 500 },
      coarsenStartMin: 15,
      defaultTrimM: 0,
    });
    expect(normalizeSettings({ distance: { mode: "evil" }, coarsenStartMin: 7 })).toEqual(DEFAULT_PRIVACY_SETTINGS);
  });

  it("distance policy only touches fogged activities", () => {
    expect(publishedDistance(5049, 4000, false, { mode: "visible-only", roundToM: 100 })).toBe(5049);
    expect(publishedDistance(5049, 4000, true, { mode: "include-rounded", roundToM: 100 })).toBe(5000);
    expect(publishedDistance(5049, 4000, true, { mode: "include-exact", roundToM: 100 })).toBe(5049);
    expect(publishedDistance(5049, 4000, true, { mode: "visible-only", roundToM: 100 })).toBe(4000);
  });

  it("coarsens the start time", () => {
    const d = new Date("2026-10-01T07:23:41Z");
    expect(coarsenStart(d, 0).toISOString()).toBe("2026-10-01T07:23:41.000Z");
    expect(coarsenStart(d, 15).toISOString()).toBe("2026-10-01T07:15:00.000Z");
    expect(publishedStart({ startDateUtc: d, utcOffsetMin: -420 }, { ...DEFAULT_PRIVACY_SETTINGS, coarsenStartMin: 60 }).publishedLocalTime).toBe("00:00");
  });
});

// ---------------------------------------------------------------------------
// fog through the full publish math on a real gps fit

const fixture = (name: string) => new Uint8Array(fs.readFileSync(path.join(__dirname, "fixtures", name)));
const inner = unwrapTrackFile(fixture("sample-gps.fit.gz"), "x.fit.gz").bytes;
const track = canonicalFromDeviceFile(inner, "x.fit", sha256Hex(inner));
const gpsIdx = track.columns.lat.map((v, i) => (v !== null ? i : -1)).filter((i) => i >= 0);
const mid = gpsIdx[Math.floor(gpsIdx.length / 2)];
const midLat = track.columns.lat[mid]!;
const midLng = track.columns.lng[mid]!;
const zone = { id: 1, polygon: square(midLat, midLng, 0.0015) };
const settings = DEFAULT_PRIVACY_SETTINGS;

function allPublishedPoints(cols: { polyline: string | null; cardPolyline: string | null; bounds: unknown }): [number, number][] {
  const pts: [number, number][] = [];
  for (const s of [cols.polyline, cols.cardPolyline]) if (s) pts.push(...decodeMultiPolyline(s).flat());
  return pts;
}

describe("publishTrack with a zone (leak checks)", () => {
  const plain = computePublicColumns(track, [], { zones: [], settings });
  const fogged = publishTrack(track, [], { zones: [zone], settings });

  it("no published point (detail or card) falls inside the zone", () => {
    const pts = allPublishedPoints(fogged.columns);
    expect(pts.length).toBeGreaterThan(10);
    for (const [lat, lng] of pts) expect(pointInPolygon(lat, lng, zone.polygon)).toBe(false);
    for (const seg of fogged.visible) for (const s of seg) expect(pointInPolygon(s.lat, s.lng, zone.polygon)).toBe(false);
  });

  it("bounds come from published points only", () => {
    const b = fogged.columns.bounds!;
    const pts = allPublishedPoints({ ...fogged.columns, cardPolyline: null });
    // decoded points are rounded to 1e-5 by the polyline encoding
    expect(Math.abs(b.minLat - Math.min(...pts.map((p) => p[0])))).toBeLessThan(1e-5);
    expect(Math.abs(b.maxLng - Math.max(...pts.map((p) => p[1])))).toBeLessThan(1e-5);
    for (const [lat, lng] of [[b.minLat, b.minLng], [b.maxLat, b.maxLng]]) expect(pointInPolygon(lat, lng, zone.polygon)).toBe(false);
  });

  it("emits fog events + the public shape, and rounds the distance", () => {
    expect(fogged.columns.fogEvents!.length).toBeGreaterThan(0);
    expect(fogged.columns.fogShapes).toEqual([publicZoneShape(zone.polygon)]);
    expect(fogged.columns.distanceM % 100).toBe(0);
    expect(plain.fogEvents).toBeNull();
    expect(plain.polyline!.includes(" ")).toBe(false);
    expect(fogged.columns.polyline!.includes(" ")).toBe(true);
  });

  it("a zone that doesn't touch the track changes nothing and isn't hashed", () => {
    const far = { id: 9, polygon: square(midLat + 1, midLng + 1, 0.001) };
    expect(computePublicColumns(track, [], { zones: [far], settings })).toEqual(plain);
    const bbox = trackBounds(track);
    expect(relevantZones([far], bbox)).toEqual([]);
    const ref = { kind: "device-file" as const, sha256: "a".repeat(64), detailSha256: null };
    expect(inputsHash({ track: ref, edits: [], zones: relevantZones([far], bbox), settings })).toBe(
      inputsHash({ track: ref, edits: [], zones: [], settings })
    );
  });

  it("photo pins: never inside a zone or away from the published route", () => {
    const startMs = track.startEpochMs;
    const tMid = track.columns.t[mid];
    const tVisible = track.columns.t[gpsIdx[Math.floor(gpsIdx.length * 0.8)]];
    const pins = computePhotoPins(
      [
        { id: 1, takenAt: null, gpsLat: midLat, gpsLng: midLng }, // in the zone
        { id: 2, takenAt: new Date(startMs + tMid * 1000), gpsLat: null, gpsLng: null }, // taken in the fog
        { id: 3, takenAt: new Date(startMs + tVisible * 1000), gpsLat: null, gpsLng: null }, // on the visible route
        { id: 4, takenAt: null, gpsLat: midLat + 0.5, gpsLng: midLng }, // nowhere near the route
        { id: 5, takenAt: null, gpsLat: null, gpsLng: null },
      ],
      track,
      fogged.visible,
      [zone]
    );
    expect(pins.map((p) => p.pinLat !== null)).toEqual([false, false, true, false, false]);
    expect(pointInPolygon(pins[2].pinLat!, pins[2].pinLng!, zone.polygon)).toBe(false);
    expect(computePhotoPins([{ id: 1, takenAt: null, gpsLat: 1, gpsLng: 1 }], null, [], [])[0].pinLat).toBeNull();
  });

  it("is deterministic", () => {
    expect(publishTrack(track, [], { zones: [zone], settings })).toEqual(fogged);
  });
});
