import { describe, expect, it, vi } from "vitest";
import type { HistorySet } from "lift-core";
import {
  EMPTY_BESTS,
  PriorBestsCache,
  fallbackWorkoutPrs,
  priorBests,
  sessionPrFlags,
  setPrKinds,
  workoutPrs,
} from "../prs";

const h = (workoutId: string, startedAt: number, weight: number | null, reps: number | null, extra: Partial<HistorySet> = {}): HistorySet => ({
  workoutId,
  startedAt,
  exerciseId: "bench",
  kind: "normal",
  weight,
  unit: "kg",
  reps,
  completed: true,
  ...extra,
});

const history = [h("w1", 1, 100, 5), h("w1", 1, 105, 3), h("w2", 2, 100, 6), h("w2", 2, 60, 10, { kind: "warmup" })];

describe("priorBests", () => {
  it("collects e1rm, heaviest and reps per weight from completed working sets", () => {
    const b = priorBests(history, "bench");
    expect(b.sessions).toBe(2);
    expect(b.heaviestKg).toBe(105);
    expect(b.e1rmKg).toBeCloseTo(120); // 100 x 6
    expect(b.repsAtWeight).toEqual({ "100": 6, "105": 3 });
  });

  it("ignores the excluded workout, other exercises, unchecked sets and warm-ups", () => {
    const b = priorBests(
      [...history, h("live", 3, 200, 1), h("w3", 3, 300, 1, { completed: false }), h("w4", 4, 300, 1, { exerciseId: "squat" })],
      "bench",
      "live"
    );
    expect(b.heaviestKg).toBe(105);
    expect(b.repsAtWeight["60"]).toBeUndefined();
  });

  it("converts lb to kg", () => {
    const b = priorBests([h("w1", 1, 225, 1, { unit: "lb" })], "bench");
    expect(b.heaviestKg).toBeCloseTo(102.06, 2);
  });
});

describe("setPrKinds", () => {
  const b = priorBests(history, "bench");
  const s = (weight: number | null, reps: number | null, kind: HistorySet["kind"] = "normal") => ({ kind, weight, unit: "kg" as const, reps });

  it("flags a heavier set as weight (and e1rm when it beats it)", () => {
    expect(setPrKinds(b, s(110, 1))).toEqual(["weight"]);
    expect(setPrKinds(b, s(110, 3))).toEqual(["e1rm", "weight"]);
  });

  it("flags more reps at a known weight", () => {
    expect(setPrKinds(b, s(105, 4))).toEqual(["reps_at_weight"]);
    expect(setPrKinds(b, s(100, 8))).toEqual(["e1rm", "reps_at_weight"]);
  });

  it("does not flag ties, lighter new weights, warm-ups or empty sets", () => {
    expect(setPrKinds(b, s(100, 6))).toEqual([]);
    expect(setPrKinds(b, s(90, 3))).toEqual([]);
    expect(setPrKinds(b, s(200, 5, "warmup"))).toEqual([]);
    expect(setPrKinds(b, s(null, 5))).toEqual([]);
    expect(setPrKinds(b, s(110, 0))).toEqual([]);
  });

  it("never fires on an exercise's first session", () => {
    expect(setPrKinds(EMPTY_BESTS, s(500, 5))).toEqual([]);
  });
});

describe("sessionPrFlags", () => {
  it("compares each set to history plus earlier sets this session", () => {
    const b = priorBests(history, "bench");
    const flags = sessionPrFlags(b, [
      { id: "a", kind: "normal", weight: 110, unit: "kg", reps: 2, completed: 1 },
      { id: "b", kind: "normal", weight: 110, unit: "kg", reps: 2, completed: 1 },
      { id: "c", kind: "normal", weight: 120, unit: "kg", reps: 1, completed: 0 },
      { id: "d", kind: "normal", weight: 110, unit: "kg", reps: 3, completed: true },
    ]);
    expect(flags).toEqual({ a: ["weight"], d: ["e1rm", "reps_at_weight"] });
  });
});

describe("PriorBestsCache", () => {
  it("loads once per workout and exercise", () => {
    const load = vi.fn(() => priorBests(history, "bench"));
    const cache = new PriorBestsCache(load);
    cache.get("live", "bench");
    cache.get("live", "bench");
    cache.get("live", "squat");
    expect(load).toHaveBeenCalledTimes(2);
    expect(cache.size).toBe(2);
    cache.clear();
    cache.get("live", "bench");
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("falls back to no bests when the load throws", () => {
    const cache = new PriorBestsCache(() => {
      throw new Error("db closed");
    });
    expect(cache.get("w", "bench")).toBe(EMPTY_BESTS);
  });
});

describe("fallbackWorkoutPrs", () => {
  it("reports the best hit per kind against earlier workouts only", () => {
    const all = [...history, h("w3", 3, 110, 2), h("w3", 3, 105, 5), h("w3", 3, 100, 7), h("w9", 9, 200, 5)];
    const hits = fallbackWorkoutPrs(all, "w3");
    const byKind = Object.fromEntries(hits.map((x) => [x.kind, x]));
    expect(byKind.weight).toMatchObject({ value: 110, previous: 105, set: { weight: 110, reps: 2 } });
    expect(byKind.e1rm).toMatchObject({ previous: 120, set: { weight: 100, reps: 7 } });
    expect(byKind.e1rm?.value).toBeCloseTo(100 * (1 + 7 / 30));
    // 105 x 5 and 100 x 7 are both rep prs; the most reps wins
    expect(byKind.reps_at_weight).toMatchObject({ value: 7, previous: 6, atWeightKg: 100 });
    expect(hits.every((x) => x.exerciseId === "bench")).toBe(true);
    expect(byKind.volume?.value).toBeCloseTo(220 + 525 + 700);
  });

  it("skips an exercise's first session", () => {
    expect(fallbackWorkoutPrs(history, "w1")).toEqual([]);
  });

  it("workoutPrs always returns an array", () => {
    expect(Array.isArray(workoutPrs(history, "w2"))).toBe(true);
  });
});
