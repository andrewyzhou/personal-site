import { describe, it, expect } from "vitest";
import { applyCleaning, hasCleaning, mergeTargets, validateCleaningEdit } from "../cleaning/edits";
import { cleanedStats, hrZoneSeconds, rawStatsOf, smoothedElevationGain } from "../cleaning/stats";
import { DEFAULT_ACTIVITY_SETTINGS } from "../cleaning/settings";
import { CANONICAL_FORMAT_VERSION, canonicalToParsed, type CanonicalTrack } from "../canonical-track";
import { decodeMultiPolyline } from "../polyline";
import { DEFAULT_PRIVACY_SETTINGS } from "../privacy/settings";
import { publishTrack, type EditInput } from "../republish";

// a straight eastward run: 1 sample/s at 3 m/s, optional stretches at other speeds
function makeTrack(opts: { n?: number; speedAt?: (t: number) => number; startEpochMs?: number; hr?: (t: number) => number | null; ele?: (t: number) => number | null } = {}): CanonicalTrack {
  const n = opts.n ?? 600;
  const t: number[] = [], lat: (number | null)[] = [], lng: (number | null)[] = [], speed: (number | null)[] = [], dist: number[] = [];
  const hr: (number | null)[] = [], ele: (number | null)[] = [];
  let d = 0;
  for (let i = 0; i < n; i++) {
    const v = opts.speedAt ? opts.speedAt(i) : 3;
    if (i > 0) d += v;
    t.push(i);
    lat.push(37.8);
    lng.push(-122.3 + d / 88000); // ~88 km per degree of lng at this latitude
    speed.push(v);
    dist.push(d);
    hr.push(opts.hr ? opts.hr(i) : 150);
    ele.push(opts.ele ? opts.ele(i) : 10);
  }
  return {
    format: "canonical-track",
    v: CANONICAL_FORMAT_VERSION,
    source: { kind: "device-file", sha256: "a".repeat(64), detailSha256: null, fileType: "fit" },
    sportType: "Run",
    startEpochMs: opts.startEpochMs ?? Date.UTC(2026, 9, 1, 15),
    utcOffsetMin: -420,
    hasLocalTime: true,
    syntheticTime: false,
    session: { distanceM: d, movingTimeS: n - 1, elapsedTimeS: n - 1, elevGainM: 0, avgSpeedMs: 3, maxSpeedMs: 3, avgHr: 150, maxHr: 150, avgCadence: null, avgWatts: null, maxWatts: null },
    kilojoules: 100,
    suggestedName: "run",
    columns: { t, lat, lng, ele, hr, cadence: t.map(() => null), watts: t.map(() => null), speed, dist },
  };
}

const e = (id: number, kind: string, params: Record<string, unknown>): EditInput => ({ id, kind, params });
const noTrim = e(1, "trim", { startM: 0, endM: 0 });

describe("validateCleaningEdit", () => {
  it("accepts well-formed edits and normalizes them", () => {
    expect(validateCleaningEdit("crop", { startS: 10 })).toEqual({ ok: true, params: { startS: 10, endS: null } });
    expect(validateCleaningEdit("cut", { fromS: 1, toS: 2 })).toEqual({ ok: true, params: { fromS: 1, toS: 2 } });
    expect(validateCleaningEdit("drop-points", { ts: [5, 3, 5] })).toEqual({ ok: true, params: { ts: [3, 5] } });
    expect(validateCleaningEdit("no-gps", { anything: 1 })).toEqual({ ok: true, params: {} });
    expect(validateCleaningEdit("merge", { withActivityId: 4 })).toEqual({ ok: true, params: { withActivityId: 4 } });
  });

  it("rejects bad ones", () => {
    for (const [k, p] of [
      ["crop", {}], ["crop", { startS: 10, endS: 5 }], ["crop", { startS: -1 }],
      ["cut", { fromS: 5, toS: 5 }], ["drop-points", { ts: [] }], ["drop-points", { ts: ["x"] }],
      ["merge", { withActivityId: 1.5 }], ["trim", {}], ["split", {}],
    ] as const) {
      expect(validateCleaningEdit(k, p).ok).toBe(false);
    }
  });

  it("helpers", () => {
    expect(hasCleaning([e(1, "trim", {})])).toBe(false);
    expect(hasCleaning([e(1, "cut", { fromS: 1, toS: 2 })])).toBe(true);
    expect(mergeTargets([e(1, "merge", { withActivityId: 9 }), e(2, "merge", { withActivityId: "x" })])).toEqual([9]);
  });
});

describe("applyCleaning", () => {
  const track = makeTrack();

  it("returns the very same track without cleaning edits", () => {
    const c = applyCleaning(track, [noTrim]);
    expect(c.track).toBe(track);
    expect(c.cleaned).toBe(false);
  });

  it("never mutates the input", () => {
    const before = JSON.stringify(track);
    applyCleaning(track, [e(1, "cut", { fromS: 100, toS: 200 }), e(2, "crop", { startS: 10, endS: 500 })]);
    expect(JSON.stringify(track)).toBe(before);
  });

  it("crop keeps the window; crops intersect", () => {
    const c = applyCleaning(track, [e(1, "crop", { startS: 0, endS: 100 }), e(2, "crop", { startS: 50, endS: 300 })]);
    expect(c.track.columns.t[0]).toBe(50);
    expect(c.track.columns.t[c.track.columns.t.length - 1]).toBe(100);
    expect(c.track.columns.dist[0]).toBe(0);
    expect(c.track.session).toBeNull();
    expect(c.track.kilojoules).toBeNull();
  });

  it("cut removes the stretch, breaks the line and doesn't count its distance or time", () => {
    const c = applyCleaning(track, [e(1, "cut", { fromS: 200, toS: 299 })]);
    const i = c.track.columns.t.indexOf(300);
    expect(c.breaks[i]).toBe(true);
    expect(c.breaks.filter(Boolean)).toHaveLength(1);
    expect(c.excludedS).toBe(101); // 199 → 300
    expect(c.track.columns.dist[i]).toBe(c.track.columns.dist[i - 1]);
    const total = c.track.columns.dist[c.track.columns.dist.length - 1];
    expect(total).toBeCloseTo(track.columns.dist[track.columns.dist.length - 1] - 101 * 3, 6);
  });

  it("drop-points removes samples; no-gps drops positions but keeps device distance", () => {
    const d = applyCleaning(track, [e(1, "drop-points", { ts: [10, 11] })]);
    expect(d.track.columns.t.includes(10)).toBe(false);
    expect(d.breaks.some(Boolean)).toBe(false);
    const n = applyCleaning(track, [e(1, "no-gps", {})]);
    expect(n.track.columns.lat.every((v) => v === null)).toBe(true);
    expect(n.track.columns.dist[n.track.columns.dist.length - 1]).toBeCloseTo(track.columns.dist[track.columns.dist.length - 1], 6);
  });

  it("merge appends a later track after a gap", () => {
    const later = makeTrack({ n: 100, startEpochMs: track.startEpochMs + 3600_000 });
    const c = applyCleaning(track, [e(1, "merge", { withActivityId: 2 })], [later]);
    expect(c.track.columns.t.length).toBe(700);
    expect(c.track.columns.t[600]).toBe(3600);
    expect(c.breaks[600]).toBe(true);
    expect(c.excludedS).toBe(3600 - 599);
  });
});

describe("cleaned stats", () => {
  it("moving time excludes stops below the sport's idle speed", () => {
    // 60 s standing still at a light in the middle
    const t = makeTrack({ speedAt: (i) => (i >= 300 && i < 360 ? 0 : 3) });
    const c = applyCleaning(t, [e(1, "crop", { startS: 0, endS: 599 })]);
    const p = canonicalToParsed(c.track);
    const s = cleanedStats(p.records, p.cumDist, c.breaks, c.excludedS, "Run");
    expect(s.movingTimeS).toBe(599 - 60);
    expect(s.elapsedTimeS).toBe(599);
    expect(s.avgSpeedMs).toBeCloseTo(s.distanceM / s.movingTimeS, 9);
  });

  it("elevation: smoothing + hysteresis ignore noise, count real climbs", () => {
    const noisy = Array.from({ length: 200 }, (_, i) => 100 + (i % 2 ? 1 : -1));
    expect(smoothedElevationGain(noisy)).toBe(0);
    const climb = Array.from({ length: 200 }, (_, i) => 100 + i * 0.5);
    expect(smoothedElevationGain(climb)).toBeGreaterThan(95);
    expect(smoothedElevationGain(climb)).toBeLessThanOrEqual(99.5);
  });

  it("hr zones are time-weighted and skip breaks", () => {
    const t = makeTrack({ n: 101, hr: (i) => (i < 50 ? 100 : 180) });
    const c = applyCleaning(t, []);
    const zones = hrZoneSeconds(canonicalToParsed(c.track).records, c.breaks, 190, [0.6, 0.7, 0.8, 0.9]);
    expect(zones).toEqual([50, 0, 0, 0, 50]);
    expect(hrZoneSeconds(canonicalToParsed(makeTrack({ hr: () => null })).records, [], 190, [0.6, 0.7, 0.8, 0.9])).toBeNull();
  });

  it("raw stats prefer device totals", () => {
    const t = makeTrack();
    const p = canonicalToParsed(t);
    expect(rawStatsOf(t.session, p.records, p.cumDist).movingTimeS).toBe(599);
    expect(rawStatsOf(null, p.records, p.cumDist).distanceM).toBeCloseTo(t.columns.dist[599], 6);
  });
});

describe("publishTrack with cleaning", () => {
  const ctx = { zones: [], settings: DEFAULT_PRIVACY_SETTINGS, activity: DEFAULT_ACTIVITY_SETTINGS };
  // a car ride (15 m/s) from 200 s to 400 s inside a 3 m/s run
  const car = makeTrack({ speedAt: (i) => (i >= 200 && i < 400 ? 15 : 3) });

  it("untouched activities keep the device totals (no shift without edits)", () => {
    const p = publishTrack(car, [noTrim], ctx);
    expect(p.columns.distanceM).toBe(car.session!.distanceM);
    expect(p.cleaned).toBe(false);
    expect(p.rawStats.distanceM).toBe(car.session!.distanceM);
  });

  it("cutting the car ride removes its distance and time and splits the route", () => {
    const p = publishTrack(car, [noTrim, e(2, "cut", { fromS: 200, toS: 399 })], ctx);
    expect(p.cleaned).toBe(true);
    expect(p.columns.distanceM).toBeCloseTo(car.session!.distanceM - 200 * 15, -1);
    expect(p.columns.elapsedTimeS).toBeLessThan(420);
    expect(decodeMultiPolyline(p.columns.polyline!)).toHaveLength(2);
    expect(p.columns.hrZonesS).not.toBeNull();
    // raw stats still describe the untouched recording
    expect(p.rawStats.distanceM).toBe(car.session!.distanceM);
  });
});

