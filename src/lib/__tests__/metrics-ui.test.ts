import { describe, it, expect } from "vitest";
import {
  MIN_BAR,
  barFractions,
  bestEffortLabel,
  climbCategoryLabel,
  clock,
  curveGeometry,
  curveTicks,
  curveValueAt,
  durationLabel,
  effortPaceSPerKm,
  formatDist,
  formatElevPair,
  formatGrade,
  formatPaceSPerKm,
  formatSpeedMs,
  isShortSplit,
  logScale,
  splitSpeedMs,
  zoneOpacity,
  zoneSlices,
} from "@/components/activity-metrics/format";
import { BEST_EFFORT_DISTANCES } from "@/lib/metrics/compute";
import { BEST_EFFORT_KEYS, type ActivityMetricsContent } from "@/content/site-types";

// copy fixture: the helpers take their labels from site.yaml, these stand in
const LABELS: Pick<ActivityMetricsContent["bestEfforts"], "labels"> & Pick<ActivityMetricsContent, "climbs" | "zones"> = {
  labels: {
    "400m": "400 m",
    "half-mile": "1/2 mile",
    "1k": "1 km",
    "1mi": "1 mile",
    "2mi": "2 mile",
    "5k": "5 km",
    "10k": "10 km",
    "15k": "15 km",
    "10mi": "10 mile",
    "20k": "20 km",
    half: "half marathon",
    "30k": "30 km",
    marathon: "marathon",
  },
  climbs: { title: "climbs", climb: "climb", distance: "distance", gain: "gain", grade: "grade avg / max", category: "cat {category}", hc: "hc" },
  zones: { title: "zones", heartRate: "heart rate", pace: "pace", zone: "z{n}" },
};

describe("unit conversion", () => {
  it("formats s/km pace as /mi by default and /km on request", () => {
    expect(formatPaceSPerKm(300)).toBe("8:03 /mi"); // 300 s/km × 1.609 = 482.8 s
    expect(formatPaceSPerKm(300, "km")).toBe("5:00 /km");
    expect(formatPaceSPerKm(null)).toBeNull();
    expect(formatPaceSPerKm(0)).toBeNull();
    expect(formatPaceSPerKm(Number.NaN)).toBeNull();
  });

  it("formats m/s as mph or km/h", () => {
    expect(formatSpeedMs(10)).toBe("22.4 mph");
    expect(formatSpeedMs(10, "km")).toBe("36.0 km/h");
    expect(formatSpeedMs(0)).toBeNull();
    expect(formatSpeedMs(null)).toBeNull();
  });

  it("formats distances and elevation", () => {
    expect(formatDist(1609.344)).toBe("1.00 mi");
    expect(formatDist(680, "km")).toBe("0.68 km");
    expect(formatElevPair(10, 5)).toBe("+33 / −16 ft");
    expect(formatElevPair(10, null)).toBe("+33 / −0 ft");
    expect(formatElevPair(null, null)).toBeNull();
    expect(formatGrade(4.25)).toBe("4.3%");
  });

  it("clock formats with and without hours", () => {
    expect(clock(65)).toBe("1:05");
    expect(clock(3725)).toBe("1:02:05");
  });
});

describe("splits", () => {
  it("flags only noticeably short splits", () => {
    expect(isShortSplit({ distM: 1609 }, "mi")).toBe(false);
    expect(isShortSplit({ distM: 700 }, "mi")).toBe(true);
    expect(isShortSplit({ distM: 1000 }, "km")).toBe(false);
    expect(isShortSplit({ distM: 900 }, "km")).toBe(true);
  });

  it("derives speed from pace, else distance over moving time", () => {
    expect(splitSpeedMs({ distM: 1000, movingS: 999, paceSPerKm: 250 })).toBe(4);
    expect(splitSpeedMs({ distM: 1000, movingS: 100, paceSPerKm: null })).toBe(10);
    expect(splitSpeedMs({ distM: 1000, movingS: 0, paceSPerKm: null })).toBeNull();
  });

  it("bar widths: faster is longer, slowest keeps a minimum, null is empty", () => {
    const f = barFractions([3, 4, null, 5, 0.5]);
    expect(f[0]).toBeCloseTo(0.6); // proportional to the fastest
    expect(f[1]).toBeCloseTo(0.8);
    expect(f[2]).toBe(0);
    expect(f[3]).toBe(1);
    expect(f[4]).toBe(MIN_BAR); // floor keeps it visible
    expect(barFractions([4, 4])).toEqual([1, 1]);
    expect(barFractions([null, null])).toEqual([0, 0]);
  });
});

describe("labels", () => {
  it("has a human label for every best effort distance", () => {
    // site.yaml validation requires a label for every BEST_EFFORT_KEYS entry
    expect(BEST_EFFORT_DISTANCES.map((d) => d.key)).toEqual([...BEST_EFFORT_KEYS]);
    const labels: Record<string, string> = LABELS.labels;
    for (const { key, distM } of BEST_EFFORT_DISTANCES) {
      expect(key in labels).toBe(true);
      expect(bestEffortLabel(key, distM, labels)).toBe(labels[key]);
    }
    expect(bestEffortLabel("half-mile", 805, labels)).toBe("1/2 mile");
    expect(bestEffortLabel("half", 21097.5, labels)).toBe("half marathon");
    expect(bestEffortLabel("unknown", 2500, labels)).toBe("2.5 km");
    expect(bestEffortLabel("unknown", 600, labels)).toBe("600 m");
  });

  it("effort pace", () => {
    expect(effortPaceSPerKm(5000, 1500)).toBe(300);
    expect(effortPaceSPerKm(0, 10)).toBeNull();
  });

  it("climb categories", () => {
    expect(climbCategoryLabel("4", LABELS.climbs)).toBe("cat 4");
    expect(climbCategoryLabel("hc", LABELS.climbs)).toBe("hc");
    expect(climbCategoryLabel(null, LABELS.climbs)).toBeNull();
  });

  it("duration labels", () => {
    expect(durationLabel(5)).toBe("5 s");
    expect(durationLabel(60)).toBe("1 min");
    expect(durationLabel(1200)).toBe("20 min");
    expect(durationLabel(3600)).toBe("1 h");
    expect(durationLabel(5400)).toBe("1.5 h");
  });
});

describe("zones", () => {
  it("slices by fraction with whole minutes", () => {
    const z = zoneSlices([60, 180, 0, 360, 600], LABELS.zones.zone);
    expect(z?.map((s) => s.label)).toEqual(["z1", "z2", "z3", "z4", "z5"]);
    expect(z?.[0].fraction).toBeCloseTo(0.05);
    expect(z?.[4].minutes).toBe(10);
    expect(z?.reduce((a, s) => a + s.fraction, 0)).toBeCloseTo(1);
  });

  it("nothing to show → null", () => {
    expect(zoneSlices(null, LABELS.zones.zone)).toBeNull();
    expect(zoneSlices([], LABELS.zones.zone)).toBeNull();
    expect(zoneSlices([0, 0, 0, 0, 0], LABELS.zones.zone)).toBeNull();
    expect(zoneSlices([-5, Number.NaN, 0, 0, 0], LABELS.zones.zone)).toBeNull();
  });

  it("shading increases from z1 to z5", () => {
    const o = [0, 1, 2, 3, 4].map((i) => zoneOpacity(i, 5));
    expect(o[0]).toBeCloseTo(0.18);
    expect(o[4]).toBeCloseTo(0.9);
    for (let i = 1; i < o.length; i++) expect(o[i]).toBeGreaterThan(o[i - 1]);
  });
});

describe("curves", () => {
  it("log scale maps the ends and is logarithmic between", () => {
    const sx = logScale(5, 3600, 0, 100);
    expect(sx(5)).toBeCloseTo(0);
    expect(sx(3600)).toBeCloseTo(100);
    const mid = Math.sqrt(5 * 3600);
    expect(sx(mid)).toBeCloseTo(50);
  });

  it("ticks are the standard ones within range", () => {
    expect(curveTicks(5, 7200)).toEqual([5, 60, 300, 1200, 3600]);
    expect(curveTicks(10, 1800)).toEqual([60, 300, 1200]);
  });

  it("geometry: path through sorted points, higher values drawn higher", () => {
    const curve = [
      { durS: 60, value: 300 },
      { durS: 5, value: 600 },
      { durS: 1200, value: 200 },
      { durS: 300, value: 0 }, // invalid, dropped
    ];
    const g = curveGeometry(curve, 600, 100);
    expect(g).not.toBeNull();
    expect(g!.points.map((p) => p.durS)).toEqual([5, 60, 1200]);
    expect(g!.points[0].x).toBe(0);
    expect(g!.points[2].x).toBe(600);
    expect(g!.points[0].y).toBeLessThan(g!.points[1].y);
    expect(g!.path.startsWith("M0,")).toBe(true);
    expect(g!.ticks.map((t) => t.label)).toEqual(["5 s", "1 min", "5 min", "20 min"]);
    expect(g!.yMin).toBeGreaterThanOrEqual(0);
    expect(g!.yMax).toBeGreaterThan(600);
  });

  it("geometry needs two points", () => {
    expect(curveGeometry([{ durS: 5, value: 100 }], 600, 100)).toBeNull();
    expect(curveGeometry(null, 600, 100)).toBeNull();
  });

  it("value lookup at a duration", () => {
    expect(curveValueAt([{ durS: 60, value: 250 }], 60)).toBe(250);
    expect(curveValueAt([{ durS: 60, value: 250 }], 300)).toBeNull();
  });
});
