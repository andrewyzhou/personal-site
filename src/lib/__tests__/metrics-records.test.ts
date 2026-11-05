import { describe, expect, it } from "vitest";
import { METRICS_FORMAT_VERSION, type ActivityMetrics, type BestEffort, type CurvePoint } from "@/lib/metrics/types";
import {
  SHOE_ALERT_M,
  bestEffortRecords,
  curveRecords,
  fitnessSeries,
  gearTotals,
  prKeysFor,
  type RecordInput,
} from "@/lib/metrics/records";

function metrics(efforts: BestEffort[], extra: Partial<ActivityMetrics> = {}): ActivityMetrics {
  return {
    v: METRICS_FORMAT_VERSION, sportType: "Run", movingS: 0, elapsedS: 0, distM: 0,
    movingPaceSPerKm: null, movingSpeedMs: null, gapSPerKm: null, splitsKm: [], splitsMi: [],
    bestEfforts: efforts, speedCurve: null, powerCurve: null, paceZonesS: null, effort: null, climbs: [],
    ...extra,
  };
}
const e = (key: string, timeS: number): BestEffort => ({ key, distM: 1000, timeS, startS: 0 });
const input = (activityId: number, date: string, m: ActivityMetrics): RecordInput => ({ activityId, date, name: `a${activityId}`, metrics: m });

describe("bestEffortRecords", () => {
  const list = [
    input(1, "2026-01-01", metrics([e("1k", 250), e("5k", 1500)])),
    input(2, "2026-02-01", metrics([e("1k", 240)])),
    input(3, "2026-03-01", metrics([e("1k", 240), e("5k", 1490)])),
    input(4, "2026-04-01", metrics([e("1k", 300)])),
  ];
  it("ranks fastest first, earliest wins a tie, top n", () => {
    const r = bestEffortRecords(list, 3);
    expect(r["1k"].map((x) => x.activityId)).toEqual([2, 3, 1]);
    expect(r["5k"].map((x) => x.activityId)).toEqual([3, 1]);
    expect(r["1k"][0]).toMatchObject({ date: "2026-02-01", name: "a2", timeS: 240 });
  });
  it("prKeysFor lists the distances an activity holds the record for", () => {
    const r = bestEffortRecords(list);
    expect(prKeysFor(3, r)).toEqual(["5k"]);
    expect(prKeysFor(2, r)).toEqual(["1k"]);
    expect(prKeysFor(4, r)).toEqual([]);
  });
});

describe("curveRecords", () => {
  it("keeps the best value per duration with its source", () => {
    const c = (pts: [number, number][]): CurvePoint[] => pts.map(([durS, value]) => ({ durS, value }));
    const list = [
      input(1, "2026-01-01", metrics([], { powerCurve: c([[5, 600], [60, 300]]) })),
      input(2, "2026-01-02", metrics([], { powerCurve: c([[5, 550], [60, 320], [300, 250]]) })),
      input(3, "2026-01-03", metrics([], { powerCurve: null })),
    ];
    expect(curveRecords(list, "powerCurve").map((p) => [p.durS, p.value, p.activityId])).toEqual([
      [5, 600, 1], [60, 320, 2], [300, 250, 2],
    ]);
    expect(curveRecords(list, "speedCurve")).toEqual([]);
  });
});

describe("fitnessSeries", () => {
  it("is empty without any effort", () => {
    expect(fitnessSeries([{ date: "2026-01-01", effort: null }], "2026-01-10")).toEqual([]);
  });
  it("builds up with load and decays on rest days", () => {
    const s = fitnessSeries(
      [{ date: "2026-01-01", effort: 100 }, { date: "2026-01-01", effort: 50 }, { date: "2026-01-03", effort: 100 }],
      "2026-01-20"
    );
    expect(s[0]).toMatchObject({ date: "2026-01-01", load: 150, form: 0 });
    expect(s).toHaveLength(20);
    expect(s[0].fatigue).toBeGreaterThan(s[0].fitness); // fatigue reacts faster
    const last = s[s.length - 1];
    expect(last.load).toBe(0);
    expect(last.fatigue).toBeLessThan(s[2].fatigue); // decayed
    expect(last.form).toBeGreaterThan(0); // rested: fitness outlasts fatigue
  });
  it("ignores a range that ends before the first effort", () => {
    expect(fitnessSeries([{ date: "2026-02-01", effort: 10 }], "2026-01-01")).toEqual([]);
  });
});

describe("gearTotals", () => {
  it("sums distance per gear and flags worn shoes only", () => {
    const g = gearTotals([
      { gear: "pegasus", distanceM: SHOE_ALERT_M - 1000, sportType: "Run", date: "2026-01-01" },
      { gear: "pegasus", distanceM: 2000, sportType: "Run", date: "2026-03-01" },
      { gear: " bike ", distanceM: SHOE_ALERT_M * 3, sportType: "Ride", date: "2026-02-01" },
      { gear: null, distanceM: 5000, sportType: "Run", date: "2026-02-01" },
      { gear: "", distanceM: 5000, sportType: "Run", date: "2026-02-01" },
    ]);
    expect(g.map((x) => x.gear)).toEqual(["pegasus", "bike"]);
    expect(g[0]).toMatchObject({ activities: 2, firstDate: "2026-01-01", lastDate: "2026-03-01", alert: true });
    expect(g[1].alert).toBe(false);
  });
});
