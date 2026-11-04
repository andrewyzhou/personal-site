import { describe, expect, it } from "vitest";
import { platesFor, warmupSets } from "../calc";

describe("platesFor", () => {
  it("loads a standard lb bar greedily, heaviest first", () => {
    expect(platesFor(225, "lb")).toEqual({ unit: "lb", bar: 45, perSide: [45, 45], achieved: 225, remainder: 0 });
    expect(platesFor(185, "lb").perSide).toEqual([45, 25]);
    expect(platesFor(135, "lb").perSide).toEqual([45]);
    expect(platesFor(320, "lb").perSide).toEqual([45, 45, 45, 2.5]);
  });

  it("returns just the bar at or below the bar weight", () => {
    expect(platesFor(45, "lb")).toEqual({ unit: "lb", bar: 45, perSide: [], achieved: 45, remainder: 0 });
    expect(platesFor(30, "lb")).toEqual({ unit: "lb", bar: 45, perSide: [], achieved: 45, remainder: 0 });
    expect(platesFor(Number.NaN, "kg")).toMatchObject({ perSide: [], achieved: 20, remainder: 0 });
  });

  it("reports what it can't make as a remainder", () => {
    const r = platesFor(228, "lb");
    expect(r.perSide).toEqual([45, 45]);
    expect(r.achieved).toBe(225);
    expect(r.remainder).toBe(3);
    // 1 lb per side short of a 2.5
    expect(platesFor(51, "lb")).toMatchObject({ perSide: [2.5], achieved: 50, remainder: 1 });
  });

  it("stays exact with fractional kg plates", () => {
    expect(platesFor(102.5, "kg")).toEqual({ unit: "kg", bar: 20, perSide: [25, 15, 1.25], achieved: 102.5, remainder: 0 });
    expect(platesFor(22.5, "kg")).toMatchObject({ perSide: [1.25], achieved: 22.5, remainder: 0 });
    expect(platesFor(20.1 + 2.4, "kg")).toMatchObject({ perSide: [1.25], achieved: 22.5, remainder: 0 });
    expect(platesFor(57.5, "kg").perSide).toEqual([15, 2.5, 1.25]);
    // remainders don't come back as 0.19999999
    expect(platesFor(23, "kg").remainder).toBe(0.5);
    // 1.25 per side -> every 2.5 kg is reachable
    for (let t = 20; t <= 300; t += 2.5) {
      const r = platesFor(t, "kg");
      expect(r.remainder).toBe(0);
      expect(r.achieved).toBe(t);
    }
  });

  it("respects inventory", () => {
    const r = platesFor(315, "lb", { inventory: { 45: 2 } });
    expect(r.perSide).toEqual([45, 45, 35, 10]);
    expect(r.achieved).toBe(315);
    expect(platesFor(315, "lb", { inventory: { 45: 0, 35: 1 } }).perSide).toEqual([35, 25, 25, 25, 25]);
    // out of everything -> remainder
    const out = platesFor(300, "kg", { plates: [20], inventory: { 20: 2 } });
    expect(out).toMatchObject({ perSide: [20, 20], achieved: 100, remainder: 200 });
    expect(platesFor(25, "kg", { inventory: { 2.5: 1 } }).perSide).toEqual([2.5]);
  });

  it("accepts custom bar and plate sets in any order", () => {
    expect(platesFor(100, "kg", { bar: 15, plates: [5, 20, 10, 2.5, 0, -5] })).toMatchObject({
      bar: 15,
      perSide: [20, 20, 2.5],
      achieved: 100,
      remainder: 0,
    });
    expect(platesFor(140, "lb", { plates: [25, 25, 10] }).perSide).toEqual([25, 10, 10]);
  });
});

describe("warmupSets", () => {
  it("ramps from the bar to ~80% for a lb working weight", () => {
    expect(warmupSets(225, "lb")).toEqual([
      { weight: 45, reps: 10, pct: 0.2 },
      { weight: 90, reps: 5, pct: 0.4 },
      { weight: 135, reps: 3, pct: 0.6 },
      { weight: 180, reps: 2, pct: 0.8 },
    ]);
  });

  it("rounds to the kg increment without float noise", () => {
    expect(warmupSets(102.5, "kg")).toEqual([
      { weight: 20, reps: 10, pct: 0.2 },
      { weight: 40, reps: 5, pct: 0.4 },
      { weight: 62.5, reps: 3, pct: 0.6 },
      { weight: 82.5, reps: 2, pct: 0.8 },
    ]);
    expect(warmupSets(100, "kg", { increment: 1.25 }).map((s) => s.weight)).toEqual([20, 40, 60, 80]);
    expect(warmupSets(61.25, "kg", { increment: 1.25 }).map((s) => s.weight)).toEqual([20, 25, 36.25, 48.75]);
  });

  it("skips steps that round to or below the bar", () => {
    expect(warmupSets(135, "lb").map((s) => s.weight)).toEqual([45, 55, 80, 110]);
    expect(warmupSets(95, "lb").map((s) => s.weight)).toEqual([45, 55, 75]);
    expect(warmupSets(60, "kg").map((s) => s.weight)).toEqual([20, 25, 35, 47.5]);
  });

  it("gives just the bar, or nothing, for very light working weights", () => {
    expect(warmupSets(55, "lb")).toEqual([{ weight: 45, reps: 10, pct: 0.82 }]);
    expect(warmupSets(50, "lb").map((s) => s.weight)).toEqual([45]);
    expect(warmupSets(45, "lb")).toEqual([]);
    expect(warmupSets(30, "lb")).toEqual([]);
    expect(warmupSets(0, "kg")).toEqual([]);
    expect(warmupSets(Number.NaN, "kg")).toEqual([]);
  });

  it("never reaches or passes the working weight and only climbs", () => {
    for (const unit of ["lb", "kg"] as const) {
      for (let w = 1; w <= 600; w += 0.5) {
        const sets = warmupSets(w, unit);
        for (let i = 0; i < sets.length; i++) {
          expect(sets[i].weight).toBeLessThan(w);
          if (i > 0) expect(sets[i].weight).toBeGreaterThan(sets[i - 1].weight);
          if (i > 0) expect(sets[i].reps).toBeLessThan(sets[i - 1].reps);
        }
      }
    }
  });

  it("honours a custom bar", () => {
    expect(warmupSets(100, "lb", { bar: 35 }).map((s) => s.weight)).toEqual([35, 40, 60, 80]);
    expect(warmupSets(30, "lb", { bar: 25, increment: 2.5 }).map((s) => s.weight)).toEqual([25]);
  });
});
