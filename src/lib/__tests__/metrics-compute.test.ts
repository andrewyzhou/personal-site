import { describe, it, expect } from "vitest";
import type { MetricSample, MetricsInput } from "@/lib/metrics/types";
import {
  BEST_EFFORT_DISTANCES,
  CURVE_DURATIONS_S,
  bestEfforts,
  climbCategory,
  computeMetrics,
  computeSplits,
  elevationChanges,
  fastestOver,
  findClimbs,
  gradeAdjustedPace,
  gradeSeries,
  isFootSport,
  isMovingStep,
  isRideSport,
  minettiCostRatio,
  movingTimeS,
  paceZones,
  powerCurve,
  smoothedElevation,
  speedCurve,
  trimpEffort,
} from "@/lib/metrics/compute";

interface TrackOpts {
  n: number; // samples
  t0?: number;
  d0?: number;
  dt?: number;
  speed?: number | ((i: number) => number); // m/s
  ele?: ((d: number, i: number) => number | null) | null;
  hr?: number | null;
  watts?: number | ((i: number) => number | null) | null;
  deviceSpeed?: boolean;
}

// a synthetic track: one sample every dt seconds at the given speed
function track(o: TrackOpts): MetricSample[] {
  const dt = o.dt ?? 1;
  const out: MetricSample[] = [];
  let t = o.t0 ?? 0;
  let d = o.d0 ?? 0;
  for (let i = 0; i < o.n; i++) {
    const v = typeof o.speed === "function" ? o.speed(i) : (o.speed ?? 3);
    if (i > 0) {
      t += dt;
      d += v * dt;
    }
    const w = typeof o.watts === "function" ? o.watts(i) : (o.watts ?? null);
    out.push({
      t,
      d,
      ele: o.ele ? o.ele(d, i) : null,
      hr: o.hr ?? null,
      watts: w,
      cadence: null,
      speed: o.deviceSpeed ? v : null,
    });
  }
  return out;
}

const lastOf = (s: MetricSample[]) => s[s.length - 1];

// continue a track after a fog gap: time jumps by gapS, distance does not
function after(prev: MetricSample[], gapS: number, o: TrackOpts): MetricSample[] {
  const l = lastOf(prev);
  return track({ ...o, t0: l.t + gapS, d0: l.d });
}

function input(segments: MetricSample[][], over: Partial<MetricsInput> = {}): MetricsInput {
  return { segments, sportType: "Run", hrMaxBpm: null, hrRestBpm: null, thresholdPaceSPerKm: null, ...over };
}

describe("sport sets", () => {
  it("classifies foot and ride sports", () => {
    for (const s of ["Run", "TrailRun", "VirtualRun", "Walk", "Hike"]) expect(isFootSport(s)).toBe(true);
    for (const s of ["Ride", "VirtualRide", "MountainBikeRide", "GravelRide", "EBikeRide"]) expect(isRideSport(s)).toBe(true);
    expect(isFootSport("Ride")).toBe(false);
    expect(isRideSport("Swim")).toBe(false);
  });
});

describe("isMovingStep / movingTimeS", () => {
  const p = (t: number, d: number, speed: number | null = null): MetricSample => ({
    t, d, ele: null, hr: null, watts: null, cadence: null, speed,
  });
  it("counts short steps above idle speed", () => {
    expect(isMovingStep(p(0, 0), p(1, 3), 0.5)).toBe(true);
    expect(isMovingStep(p(0, 0), p(1, 0.2), 0.5)).toBe(false);
    expect(isMovingStep(p(0, 0), p(11, 100), 0.5)).toBe(false); // recording gap
    expect(isMovingStep(p(5, 0), p(5, 3), 0.5)).toBe(false); // dt 0
  });
  it("prefers device speed", () => {
    expect(isMovingStep(p(0, 0), p(1, 3, 0), 0.5)).toBe(false);
    expect(isMovingStep(p(0, 0), p(1, 0, 2), 0.5)).toBe(true);
  });
  it("constant pace is all moving", () => {
    expect(movingTimeS([track({ n: 601 })], "Run")).toBe(600);
  });
  it("excludes a pause", () => {
    const s = track({ n: 601, speed: (i) => (i > 100 && i <= 160 ? 0 : 3) });
    expect(movingTimeS([s], "Run")).toBe(540);
  });
  it("never counts the time across a fog gap", () => {
    const a = track({ n: 301 });
    const b = after(a, 120, { n: 301 });
    expect(movingTimeS([a, b], "Run")).toBe(600);
  });
  it("uses the sport's idle speed", () => {
    const s = track({ n: 101, speed: 0.8 });
    expect(movingTimeS([s], "Run")).toBe(100);
    expect(movingTimeS([s], "Ride")).toBe(0);
  });
});

describe("elevation helpers", () => {
  it("smoothedElevation is null without elevation", () => {
    expect(smoothedElevation(track({ n: 10 }))).toBeNull();
  });
  it("fills missing elevation by interpolation along distance", () => {
    const s = track({ n: 21, ele: (_d, i) => (i % 2 === 0 ? i : null) });
    const e = smoothedElevation(s)!;
    expect(e).toHaveLength(21);
    for (let i = 3; i < 18; i++) expect(e[i]).toBeCloseTo(i, 6);
  });
  it("smoothing damps a single spike", () => {
    const s = track({ n: 21, ele: (_d, i) => (i === 10 ? 110 : 100) });
    const e = smoothedElevation(s)!;
    expect(Math.max(...e)).toBeCloseTo(102, 6);
  });
  it("hysteresis ignores noise but counts a real climb and descent", () => {
    const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
    const noise = Array.from({ length: 100 }, (_, i) => 100 + (i % 2 ? 0.9 : -0.9));
    const n = elevationChanges(noise);
    expect(sum(n.gain)).toBe(0);
    expect(sum(n.loss)).toBe(0);
    const hill = [...Array.from({ length: 51 }, (_, i) => i), ...Array.from({ length: 50 }, (_, i) => 49 - i)];
    const h = elevationChanges(hill);
    expect(sum(h.gain)).toBe(50);
    expect(sum(h.loss)).toBe(50);
    // a jittery climb counts its true rise, not the jitter
    const jitter = Array.from({ length: 101 }, (_, i) => i * 0.5 + (i % 2 ? 1.5 : 0));
    expect(sum(elevationChanges(jitter).gain)).toBeCloseTo(51, 6); // 0 → highest sample (51)
  });
  it("gradeSeries reads a steady 5% grade", () => {
    const s = track({ n: 200, ele: (d) => 0.05 * d });
    const g = gradeSeries(s, smoothedElevation(s)!);
    for (let i = 20; i < 180; i++) expect(g[i]).toBeCloseTo(0.05, 6);
  });
  it("gradeSeries is 0 while stationary", () => {
    const s = track({ n: 20, speed: 0, ele: () => 50 });
    expect(gradeSeries(s, smoothedElevation(s)!).every((g) => g === 0)).toBe(true);
  });
});

describe("minettiCostRatio", () => {
  it("is 1 on the flat, higher uphill, lower on gentle downhill", () => {
    expect(minettiCostRatio(0)).toBe(1);
    expect(minettiCostRatio(0.1)).toBeGreaterThan(1.5);
    expect(minettiCostRatio(-0.1)).toBeLessThan(0.7);
    expect(minettiCostRatio(-0.1)).toBeGreaterThan(0.5);
  });
  it("clamps beyond ±45% and stays positive", () => {
    expect(minettiCostRatio(0.9)).toBe(minettiCostRatio(0.45));
    expect(minettiCostRatio(-0.9)).toBe(minettiCostRatio(-0.45));
    for (let g = -0.45; g <= 0.45; g += 0.01) expect(minettiCostRatio(g)).toBeGreaterThan(0);
    expect(minettiCostRatio(Number.NaN)).toBe(1);
  });
});

describe("gradeAdjustedPace", () => {
  it("equals pace on the flat", () => {
    const s = track({ n: 1001, speed: 1000 / 300, ele: () => 50 });
    expect(gradeAdjustedPace([s], "Run")).toBe(300);
  });
  it("is faster than pace uphill and slower on a gentle downhill", () => {
    const up = track({ n: 1001, speed: 1000 / 400, ele: (d) => 0.08 * d });
    expect(gradeAdjustedPace([up], "Run")!).toBeLessThan(300);
    const down = track({ n: 1001, speed: 1000 / 240, ele: (d) => 500 - 0.05 * d });
    expect(gradeAdjustedPace([down], "Run")!).toBeGreaterThan(240);
  });
  it("is null without elevation or for non-foot sports", () => {
    expect(gradeAdjustedPace([track({ n: 100 })], "Run")).toBeNull();
    expect(gradeAdjustedPace([track({ n: 100, ele: () => 1 })], "Ride")).toBeNull();
  });
});

describe("computeSplits", () => {
  const v = 1000 / 240; // 4:00/km
  it("constant pace gives equal km splits", () => {
    const s = track({ n: 721, speed: v });
    const sp = computeSplits([s], "Run", 1000);
    expect(sp).toHaveLength(3);
    for (const x of sp) {
      expect(x.distM).toBeCloseTo(1000, 0);
      expect(x.timeS).toBe(240);
      expect(x.movingS).toBe(240);
      expect(x.paceSPerKm).toBe(240);
      expect(x.gapSPerKm).toBeNull(); // no elevation
      expect(x.elevGainM).toBeNull();
      expect(x.avgHr).toBeNull();
      expect(x.partial).toBe(false);
    }
    expect(sp.map((x) => x.index)).toEqual([1, 2, 3]);
  });
  it("last split is short", () => {
    const s = track({ n: 601, speed: v });
    const sp = computeSplits([s], "Run", 1000);
    expect(sp).toHaveLength(3);
    expect(sp[2].distM).toBeCloseTo(500, 0);
    expect(sp[2].timeS).toBe(120);
  });
  it("mile splits", () => {
    const s = track({ n: 1001, speed: 5 }); // 5 km
    const sp = computeSplits([s], "Run", 1609.344);
    expect(sp).toHaveLength(4);
    expect(sp[0].distM).toBeCloseTo(1609.3, 1);
    expect(sp[0].timeS).toBe(322);
  });
  it("a pause adds elapsed but not moving time", () => {
    const s = track({ n: 361, speed: (i) => (i > 100 && i <= 220 ? 0 : 1000 / 240) });
    const sp = computeSplits([s], "Run", 1000);
    expect(sp[0].timeS).toBe(360);
    expect(sp[0].movingS).toBe(240);
    expect(sp[0].paceSPerKm).toBe(240);
  });
  it("a fog gap marks the split partial and its time excludes the gap", () => {
    const a = track({ n: 361, speed: v }); // 1500 m
    const b = after(a, 600, { n: 361, speed: v }); // another 1500 m after 10 min of fog
    const sp = computeSplits([a, b], "Run", 1000);
    expect(sp).toHaveLength(3);
    expect(sp.map((x) => x.partial)).toEqual([false, true, false]);
    expect(sp[1].timeS).toBe(240);
    expect(sp[1].distM).toBeCloseTo(1000, 0);
  });
  it("elevation gain/loss per split, noise ignored", () => {
    // flat km, climbing km (+40 m), descending km (−40 m), with ±1 m jitter
    const s = track({
      n: 721,
      speed: v,
      ele: (d, i) => {
        const base = d < 1000 ? 0 : d < 2000 ? (d - 1000) * 0.04 : 40 - (d - 2000) * 0.04;
        return base + (i % 2 ? 1 : -1);
      },
    });
    const sp = computeSplits([s], "Run", 1000);
    expect(sp[0].elevGainM).toBe(0);
    expect(sp[1].elevGainM!).toBeGreaterThan(34);
    expect(sp[1].elevGainM!).toBeLessThan(42);
    expect(sp[2].elevLossM!).toBeGreaterThan(34);
    expect(sp[1].gapSPerKm!).toBeLessThan(sp[1].paceSPerKm!);
    expect(Math.abs(sp[0].gapSPerKm! - sp[0].paceSPerKm!)).toBeLessThanOrEqual(2);
  });
  it("averages hr", () => {
    const s = track({ n: 241, speed: v, hr: 150 });
    expect(computeSplits([s], "Run", 1000)[0].avgHr).toBe(150);
  });
  it("rides get no pace", () => {
    const s = track({ n: 201, speed: 10 });
    const sp = computeSplits([s], "Ride", 1000);
    expect(sp).toHaveLength(2);
    expect(sp[0].paceSPerKm).toBeNull();
    expect(sp[0].timeS).toBe(100);
  });
  it("empty and zero-distance tracks give no splits", () => {
    expect(computeSplits([], "Run", 1000)).toEqual([]);
    expect(computeSplits([track({ n: 10, speed: 0 })], "Run", 1000)).toEqual([]);
  });
});

describe("best efforts", () => {
  it("fastestOver interpolates the far end", () => {
    const s = track({ n: 11, dt: 10, speed: 3 }); // 30 m per step
    const f = fastestOver(s, 100)!;
    expect(f.timeS).toBeCloseTo(100 / 3, 6);
    expect(fastestOver(s, 301)).toBeNull();
  });
  it("constant pace: time scales with distance, only covered distances", () => {
    const s = track({ n: 2601, speed: 1000 / 240 }); // ~10.83 km at 4:00/km
    const be = bestEfforts([s], "Run");
    const keys = be.map((b) => b.key);
    expect(keys).toEqual(["400m", "half-mile", "1k", "1mi", "2mi", "5k", "10k"]);
    const byKey = Object.fromEntries(be.map((b) => [b.key, b]));
    expect(byKey["1k"].timeS).toBe(240);
    expect(byKey["5k"].timeS).toBe(1200);
    expect(byKey["10k"].timeS).toBe(2400);
    expect(byKey["1mi"].timeS).toBe(386);
  });
  it("finds the fast stretch and where it starts", () => {
    // 5:00/km, then 1 km at 3:20 from t=600 to 800, then 5:00/km
    const s = track({ n: 1401, speed: (i) => (i > 600 && i <= 800 ? 5 : 1000 / 300) });
    const k = bestEfforts([s], "Run").find((b) => b.key === "1k")!;
    expect(k.timeS).toBe(200);
    expect(k.startS).toBe(600);
  });
  it("never spans a gap", () => {
    const a = track({ n: 801, speed: 1000 / 240 }); // 3.33 km
    const b = after(a, 300, { n: 801, speed: 1000 / 240 }); // 6.67 km in all
    const keys = bestEfforts([a, b], "Run").map((x) => x.key);
    expect(keys).toContain("2mi");
    expect(keys).not.toContain("5k");
  });
  it("lists all keys in order and only for foot sports", () => {
    expect(BEST_EFFORT_DISTANCES.map((d) => d.key)).toEqual([
      "400m", "half-mile", "1k", "1mi", "2mi", "5k", "10k", "15k", "10mi", "20k", "half", "30k", "marathon",
    ]);
    expect(bestEfforts([track({ n: 2000, speed: 8 })], "Ride")).toEqual([]);
    expect(bestEfforts([track({ n: 500, speed: 1.4 })], "Walk").map((b) => b.key)).toEqual(["400m"]);
  });
  it("marathon on a long track", () => {
    const s = track({ n: 14200, speed: 3 }); // 42.6 km
    const m = bestEfforts([s], "Run").find((b) => b.key === "marathon")!;
    expect(m.timeS).toBe(14065);
  });
});

describe("curves", () => {
  it("constant power is flat across durations that fit", () => {
    const s = track({ n: 1201, watts: 200 });
    const c = powerCurve([s])!;
    expect(c.map((p) => p.durS)).toEqual([5, 10, 30, 60, 120, 300, 600, 1200]);
    expect(c.every((p) => p.value === 200)).toBe(true);
  });
  it("a burst lifts short durations; values never increase with duration", () => {
    const s = track({ n: 1201, watts: (i) => (i >= 100 && i < 160 ? 400 : 200) });
    const c = Object.fromEntries(powerCurve([s])!.map((p) => [p.durS, p.value]));
    expect(c[5]).toBe(400);
    expect(c[60]).toBe(400);
    expect(c[120]).toBe(300);
    const vals = powerCurve([s])!.map((p) => p.value);
    for (let i = 1; i < vals.length; i++) expect(vals[i]).toBeLessThanOrEqual(vals[i - 1]);
  });
  it("missing watts inside a window count as 0", () => {
    const s = track({ n: 61, watts: (i) => (i % 2 ? null : 300) });
    expect(powerCurve([s])!.find((p) => p.durS === 60)!.value).toBe(150);
  });
  it("null without watts", () => {
    expect(powerCurve([track({ n: 100 })])).toBeNull();
  });
  it("windows never span a gap", () => {
    const a = track({ n: 701, watts: 250 });
    const b = after(a, 600, { n: 701, watts: 250 });
    const c = powerCurve([a, b])!;
    expect(c[c.length - 1].durS).toBe(600);
  });
  it("speed curve for rides only, best average speed", () => {
    const s = track({ n: 601, speed: (i) => (i > 100 && i <= 130 ? 15 : 8) });
    const c = Object.fromEntries(speedCurve([s], "Ride")!.map((p) => [p.durS, p.value]));
    expect(c[30]).toBe(15);
    expect(c[600]).toBeCloseTo((30 * 15 + 570 * 8) / 600, 2);
    expect(speedCurve([s], "Run")).toBeNull();
  });
  it("curve durations are fixed", () => {
    expect(CURVE_DURATIONS_S).toEqual([5, 10, 30, 60, 120, 300, 600, 1200, 1800, 3600, 5400, 7200]);
  });
});

describe("paceZones", () => {
  it("assigns pace relative to threshold", () => {
    const thr = 240;
    const at = (pace: number) => paceZones([track({ n: 101, speed: 1000 / pace })], "Run", thr)!;
    expect(at(330)).toEqual([100, 0, 0, 0, 0]);
    expect(at(290)).toEqual([0, 100, 0, 0, 0]);
    expect(at(260)).toEqual([0, 0, 100, 0, 0]);
    expect(at(240)).toEqual([0, 0, 0, 100, 0]);
    expect(at(220)).toEqual([0, 0, 0, 0, 100]);
  });
  it("counts moving steps only", () => {
    const s = track({ n: 201, speed: (i) => (i > 100 ? 0 : 1000 / 240) });
    expect(paceZones([s], "Run", 240)).toEqual([0, 0, 0, 100, 0]);
  });
  it("null without threshold or for rides", () => {
    expect(paceZones([track({ n: 10 })], "Run", null)).toBeNull();
    expect(paceZones([track({ n: 10 })], "Ride", 240)).toBeNull();
  });
});

describe("trimpEffort", () => {
  const expected = (min: number, hr: number, rest: number, max: number) => {
    const r = (hr - rest) / (max - rest);
    return Math.round(min * r * 0.64 * Math.exp(1.92 * r) * 10) / 10;
  };
  it("matches the Banister formula", () => {
    const s = track({ n: 3601, hr: 150 });
    expect(trimpEffort([s], 190, 50)).toBe(expected(60, 150, 50, 190));
  });
  it("rest defaults to 60", () => {
    const s = track({ n: 1801, hr: 160 });
    expect(trimpEffort([s], 190, null)).toBe(expected(30, 160, 60, 190));
  });
  it("counts stopped time too, but not the fog gap", () => {
    const a = track({ n: 601, hr: 150, speed: 0 });
    const b = after(a, 900, { n: 601, hr: 150 });
    expect(trimpEffort([a, b], 190, 60)).toBe(expected(20, 150, 60, 190));
  });
  it("clamps hr reserve", () => {
    const s = track({ n: 601, hr: 220 });
    expect(trimpEffort([s], 190, 60)).toBe(expected(10, 190, 60, 190));
    expect(trimpEffort([track({ n: 601, hr: 40 })], 190, 60)).toBe(0);
  });
  it("null without hr or hr max", () => {
    expect(trimpEffort([track({ n: 100 })], 190, 60)).toBeNull();
    expect(trimpEffort([track({ n: 100, hr: 150 })], null, 60)).toBeNull();
  });
});

describe("climbs", () => {
  // flat, then a hill of `len` m at `grade`, then flat
  const hill = (len: number, grade: number, flat = 1000) => (d: number) =>
    d < flat ? 100 : d < flat + len ? 100 + (d - flat) * grade : 100 + len * grade;

  it("categories by distance × grade", () => {
    expect(climbCategory(1000, 5)).toBeNull();
    expect(climbCategory(2000, 5)).toBe("4");
    expect(climbCategory(4000, 5)).toBe("3");
    expect(climbCategory(8000, 5)).toBe("2");
    expect(climbCategory(10000, 7)).toBe("1");
    expect(climbCategory(10000, 8)).toBe("hc");
  });
  it("finds one steady climb", () => {
    const s = track({ n: 1601, dt: 1, speed: 3, ele: hill(2000, 0.05) });
    const c = findClimbs([s]);
    expect(c).toHaveLength(1);
    expect(c[0].distM).toBeGreaterThan(1950);
    expect(c[0].distM).toBeLessThan(2050);
    expect(c[0].gainM).toBeGreaterThan(98);
    expect(c[0].avgGradePct).toBeCloseTo(5, 0);
    expect(c[0].maxGradePct).toBeCloseTo(5, 0);
    expect(c[0].category).toBe("4");
    expect(c[0].startD).toBeGreaterThan(950);
    expect(c[0].startS).toBeLessThan(c[0].endS);
  });
  it("ignores short, shallow or tiny hills", () => {
    expect(findClimbs([track({ n: 800, ele: hill(200, 0.08) })])).toEqual([]);
    expect(findClimbs([track({ n: 1600, ele: hill(2000, 0.02) })])).toEqual([]);
    expect(findClimbs([track({ n: 800, ele: hill(350, 0.04) })])).toEqual([]); // 14 m gain
    expect(findClimbs([track({ n: 100 })])).toEqual([]);
  });
  it("a small dip doesn't break a climb, a big drop does", () => {
    const dip = (d: number) => {
      if (d < 500) return 0;
      if (d < 1500) return (d - 500) * 0.06; // to 60
      if (d < 1550) return 60 - (d - 1500) * 0.06; // dip 3 m
      if (d < 2550) return 57 + (d - 1550) * 0.06; // to 117
      return 117;
    };
    expect(findClimbs([track({ n: 1000, ele: dip })])).toHaveLength(1);
    const drop = (d: number) => {
      if (d < 500) return 0;
      if (d < 1500) return (d - 500) * 0.06;
      if (d < 1800) return 60 - (d - 1500) * 0.1; // −30 m
      if (d < 2800) return 30 + (d - 1800) * 0.06;
      return 90;
    };
    expect(findClimbs([track({ n: 1100, ele: drop })])).toHaveLength(2);
  });
  it("a long flat ends a climb", () => {
    const e = (d: number) => {
      if (d < 1000) return d * 0.05; // 50 m
      if (d < 1600) return 50; // 600 m flat
      if (d < 2600) return 50 + (d - 1600) * 0.05;
      return 100;
    };
    expect(findClimbs([track({ n: 1000, ele: e })])).toHaveLength(2);
  });
  it("never spans a gap", () => {
    const a = track({ n: 501, ele: (d) => 100 + d * 0.05 }); // 1500 m climbing
    const b = after(a, 600, { n: 501, ele: (d) => 100 + d * 0.05 });
    const c = findClimbs([a, b]);
    expect(c).toHaveLength(2);
    expect(c[0].endD).toBeLessThanOrEqual(lastOf(a).d);
    expect(c[1].startD).toBeGreaterThanOrEqual(b[0].d);
  });
  it("needs elevation", () => {
    expect(findClimbs([track({ n: 2000 })])).toEqual([]);
  });
});

describe("computeMetrics", () => {
  it("null with fewer than 2 samples", () => {
    expect(computeMetrics(input([]))).toBeNull();
    expect(computeMetrics(input([track({ n: 1 })]))).toBeNull();
    expect(computeMetrics(input([[], track({ n: 1 })]))).toBeNull();
  });
  it("two samples work", () => {
    const m = computeMetrics(input([track({ n: 2 })]))!;
    expect(m.distM).toBe(3);
    expect(m.movingS).toBe(1);
    expect(m.splitsKm).toHaveLength(1);
    expect(m.bestEfforts).toEqual([]);
  });
  it("one sample per segment: no steps", () => {
    const m = computeMetrics(input([track({ n: 1 }), track({ n: 1, t0: 100, d0: 0 })]))!;
    expect(m.movingS).toBe(0);
    expect(m.movingPaceSPerKm).toBeNull();
    expect(m.movingSpeedMs).toBeNull();
  });
  it("a hilly run with a pause and a fog gap", () => {
    const e = (d: number) => (d < 2000 ? 100 : d < 3500 ? 100 + (d - 2000) * 0.06 : 190);
    const a = track({ n: 1201, speed: (i) => (i > 600 && i <= 660 ? 0 : 1000 / 300), ele: e, hr: 150 });
    const b = after(a, 300, { n: 901, speed: 1000 / 300, ele: e, hr: 155 });
    const m = computeMetrics(input([a, b], { hrMaxBpm: 190, hrRestBpm: 50, thresholdPaceSPerKm: 270 }))!;
    expect(m.v).toBe(1);
    expect(m.elapsedS).toBe(2100);
    expect(m.movingS).toBe(2040);
    expect(m.distM).toBeCloseTo(6800, 0);
    expect(m.movingPaceSPerKm).toBe(300);
    expect(m.movingSpeedMs).toBeCloseTo(3.33, 2);
    expect(m.gapSPerKm!).toBeLessThan(300);
    expect(m.splitsKm).toHaveLength(7);
    expect(m.splitsKm.filter((s) => s.partial).map((s) => s.index)).toEqual([4]);
    expect(m.splitsMi).toHaveLength(5);
    expect(m.bestEfforts.map((b) => b.key)).toContain("2mi");
    expect(m.bestEfforts.map((b) => b.key)).not.toContain("5k"); // segments are ~3.8k and ~3k
    expect(m.speedCurve).toBeNull();
    expect(m.powerCurve).toBeNull();
    expect(m.paceZonesS).toEqual([0, 0, 2040, 0, 0]); // 300 s/km is within (1.06, 1.14] × 270
    expect(m.effort!).toBeGreaterThan(0);
    expect(m.climbs).toHaveLength(1);
    expect(m.climbs[0].endD).toBeLessThanOrEqual(lastOf(a).d);
    // stable, compact output
    expect(JSON.parse(JSON.stringify(m))).toEqual(m);
  });
  it("missing hr / ele / watts", () => {
    const m = computeMetrics(input([track({ n: 601 })], { hrMaxBpm: 190 }))!;
    expect(m.effort).toBeNull();
    expect(m.gapSPerKm).toBeNull();
    expect(m.climbs).toEqual([]);
    expect(m.powerCurve).toBeNull();
    expect(m.paceZonesS).toBeNull();
    expect(m.splitsKm[0].elevGainM).toBeNull();
    expect(m.splitsKm[0].avgHr).toBeNull();
  });
  it("a ride with watts", () => {
    const s = track({ n: 3601, speed: 8, watts: (i) => (i < 300 ? 280 : 200), deviceSpeed: true });
    const m = computeMetrics(input([s], { sportType: "Ride" }))!;
    expect(m.movingPaceSPerKm).toBeNull();
    expect(m.gapSPerKm).toBeNull();
    expect(m.movingSpeedMs).toBe(8);
    expect(m.bestEfforts).toEqual([]);
    expect(m.paceZonesS).toBeNull();
    expect(m.speedCurve!.every((p) => p.value === 8)).toBe(true);
    const pc = Object.fromEntries(m.powerCurve!.map((p) => [p.durS, p.value]));
    expect(pc[300]).toBe(280);
    expect(pc[3600]).toBe(Math.round((300 * 280 + 3300 * 200) / 3600));
    expect(m.splitsKm[0].paceSPerKm).toBeNull();
    expect(m.splitsKm).toHaveLength(29);
  });
  it("other sports get speed but no pace", () => {
    const m = computeMetrics(input([track({ n: 101, speed: 1 })], { sportType: "Kayaking" }))!;
    expect(m.movingSpeedMs).toBe(1);
    expect(m.movingPaceSPerKm).toBeNull();
    expect(m.speedCurve).toBeNull();
  });
  it("is deterministic and fast on a 20k-sample track", () => {
    const s = track({
      n: 20000,
      speed: (i) => 3 + Math.sin(i / 50),
      ele: (d) => 100 + 30 * Math.sin(d / 800),
      hr: 150,
      watts: (i) => 200 + (i % 7),
    });
    const inp = input([s], { hrMaxBpm: 190, thresholdPaceSPerKm: 300 });
    const t0 = performance.now();
    const m1 = computeMetrics(inp);
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(1500);
    expect(computeMetrics(inp)).toEqual(m1);
    expect(m1!.bestEfforts.map((b) => b.key)).toContain("half");
  });
});
