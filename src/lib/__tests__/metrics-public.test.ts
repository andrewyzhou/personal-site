import { describe, expect, it } from "vitest";
import { publicMetrics } from "@/lib/public-activity";
import { computeMetrics } from "@/lib/metrics/compute";
import type { MetricSample } from "@/lib/metrics/types";

// a steady 3 m/s run over 3 km with hr
const run: MetricSample[] = Array.from({ length: 1001 }, (_, i) => ({
  t: i, d: i * 3, ele: 10, hr: 150, watts: null, cadence: 170, speed: 3,
}));
const metrics = computeMetrics({ segments: [run], sportType: "Run", hrMaxBpm: 190, hrRestBpm: 50, thresholdPaceSPerKm: null })!;

describe("publicMetrics", () => {
  it("passes metrics through for a public activity", () => {
    expect(metrics.effort).not.toBeNull();
    expect(metrics.splitsKm.some((s) => s.avgHr !== null)).toBe(true);
    expect(publicMetrics({ hidden: false, hrHidden: false }, metrics)).toBe(metrics);
  });

  it("hide hr removes every hr-derived value", () => {
    const m = publicMetrics({ hidden: false, hrHidden: true }, metrics)!;
    expect(m.effort).toBeNull();
    expect([...m.splitsKm, ...m.splitsMi].every((s) => s.avgHr === null)).toBe(true);
    expect(JSON.stringify(m)).not.toMatch(/"avgHr":\d/);
    // everything else stays
    expect(m.splitsKm.length).toBe(metrics.splitsKm.length);
    expect(m.bestEfforts).toEqual(metrics.bestEfforts);
  });

  it("private activities and missing rows give nothing", () => {
    expect(publicMetrics({ hidden: true, hrHidden: false }, metrics)).toBeNull();
    expect(publicMetrics({ hidden: false, hrHidden: false }, null)).toBeNull();
    expect(publicMetrics({ hidden: false, hrHidden: false }, undefined)).toBeNull();
  });
});
