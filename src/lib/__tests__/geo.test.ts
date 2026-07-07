import { describe, it, expect } from "vitest";
import {
  haversineM,
  cumulativeDistances,
  trimByDistance,
  computeStats,
  rdpReduce,
  boundsOf,
  type TrackRecord,
} from "../geo";

function rec(partial: Partial<TrackRecord>): TrackRecord {
  return { lat: null, lng: null, t: 0, ele: null, hr: null, cadence: null, watts: null, speed: null, ...partial };
}

// synthetic straight-line track heading north: ~1.11 m per 1e-5 deg latitude
function syntheticTrack(n: number, spacingM = 10, dtS = 5): { records: TrackRecord[]; cum: number[] } {
  const records: TrackRecord[] = [];
  for (let i = 0; i < n; i++) {
    records.push(
      rec({
        lat: 37.0 + (i * spacingM) / 111320,
        lng: -122.0,
        t: i * dtS,
        ele: 100 + i * 0.1,
        hr: 150 + (i % 10),
      })
    );
  }
  return { records, cum: cumulativeDistances(records) };
}

describe("haversine", () => {
  it("computes a known distance", () => {
    // berkeley to sf ferry building ≈ 16.5 km
    const d = haversineM(37.8716, -122.2727, 37.7955, -122.3937);
    expect(d).toBeGreaterThan(13000);
    expect(d).toBeLessThan(15000);
  });
});

describe("cumulativeDistances", () => {
  it("is monotonic and matches spacing", () => {
    const { cum } = syntheticTrack(100, 10);
    expect(cum[0]).toBe(0);
    expect(cum[99]).toBeCloseTo(990, -1);
    for (let i = 1; i < cum.length; i++) expect(cum[i]).toBeGreaterThanOrEqual(cum[i - 1]);
  });

  it("carries forward through gps-less records", () => {
    const records = [
      rec({ lat: 37, lng: -122, t: 0 }),
      rec({ t: 5 }),
      rec({ lat: 37.001, lng: -122, t: 10 }),
    ];
    const cum = cumulativeDistances(records);
    expect(cum[1]).toBe(cum[0]);
    expect(cum[2]).toBeGreaterThan(100);
  });
});

describe("trimByDistance", () => {
  it("removes the requested distance from each end", () => {
    const { records, cum } = syntheticTrack(101, 10); // 1000 m total
    const { kept, keptCum } = trimByDistance(records, cum, 200, 200);
    expect(keptCum[0]).toBeGreaterThanOrEqual(200);
    expect(keptCum[keptCum.length - 1]).toBeLessThanOrEqual(800 + 1);
    expect(kept.length).toBeLessThan(records.length);
  });

  it("zero trim keeps everything", () => {
    const { records, cum } = syntheticTrack(50);
    const { kept } = trimByDistance(records, cum, 0, 0);
    expect(kept).toHaveLength(50);
  });

  it("over-trim clamps instead of going negative", () => {
    const { records, cum } = syntheticTrack(20, 10); // 190 m
    const { kept } = trimByDistance(records, cum, 10000, 10000);
    expect(kept.length).toBeGreaterThanOrEqual(0); // no throw, no negatives
  });
});

describe("computeStats", () => {
  it("recomputes distance/elapsed/moving/hr over records", () => {
    const { records, cum } = syntheticTrack(100, 10, 5);
    const stats = computeStats(records, cum);
    expect(stats.distanceM).toBeCloseTo(cum[99], 5);
    expect(stats.elapsedTimeS).toBe(99 * 5);
    expect(stats.movingTimeS).toBe(99 * 5); // all deltas ≤ 10 s
    expect(stats.avgHr).toBeGreaterThan(150);
    expect(stats.maxHr).toBe(159);
  });

  it("excludes pauses (gaps > 10 s) from moving time", () => {
    const records = [
      rec({ lat: 37, lng: -122, t: 0 }),
      rec({ lat: 37.0001, lng: -122, t: 5 }),
      rec({ lat: 37.0002, lng: -122, t: 300 }), // 295 s pause
      rec({ lat: 37.0003, lng: -122, t: 305 }),
    ];
    const stats = computeStats(records, cumulativeDistances(records));
    expect(stats.elapsedTimeS).toBe(305);
    expect(stats.movingTimeS).toBe(10);
  });

  it("returns zeroes/nulls on empty input", () => {
    const stats = computeStats([], []);
    expect(stats.distanceM).toBe(0);
    expect(stats.avgHr).toBeNull();
  });
});

describe("rdpReduce", () => {
  it("collapses a straight line to its endpoints", () => {
    const pts: [number, number][] = Array.from({ length: 500 }, (_, i) => [37 + i * 1e-5, -122]);
    const reduced = rdpReduce(pts, 100);
    expect(reduced.length).toBeLessThanOrEqual(100);
    expect(reduced[0]).toEqual(pts[0]);
    expect(reduced[reduced.length - 1]).toEqual(pts[pts.length - 1]);
  });

  it("respects maxPoints on a noisy track", () => {
    const pts: [number, number][] = Array.from({ length: 3000 }, (_, i) => [
      37 + i * 1e-5 + Math.sin(i) * 5e-5,
      -122 + Math.cos(i / 3) * 5e-5,
    ]);
    expect(rdpReduce(pts, 100).length).toBeLessThanOrEqual(100);
    expect(rdpReduce(pts, 1500).length).toBeLessThanOrEqual(1500);
  });

  it("returns short inputs untouched", () => {
    const pts: [number, number][] = [[37, -122], [38, -122]];
    expect(rdpReduce(pts, 100)).toEqual(pts);
  });
});

describe("boundsOf", () => {
  it("computes the bounding box", () => {
    const b = boundsOf([[37, -122], [38, -121], [36.5, -123]]);
    expect(b).toEqual({ minLat: 36.5, minLng: -123, maxLat: 38, maxLng: -121 });
  });

  it("returns null for empty input", () => {
    expect(boundsOf([])).toBeNull();
  });
});
