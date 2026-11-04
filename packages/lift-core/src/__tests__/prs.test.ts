import { describe, expect, it } from "vitest";
import type { HistorySet } from "../history";
import { LB_PER_KG } from "../math";
import { detectWorkoutPrs, type PrHit, type PrKind } from "../prs";

const DAY = 86_400_000;
const T0 = Date.UTC(2024, 0, 1);
const BENCH = "bench-press-barbell";
const SQUAT = "squat-barbell";

function s(workoutId: string, day: number, weight: number | null, reps: number | null, partial: Partial<HistorySet> = {}): HistorySet {
  return {
    workoutId,
    startedAt: T0 + day * DAY,
    exerciseId: BENCH,
    kind: "normal",
    weight,
    unit: "kg",
    reps,
    completed: true,
    ...partial,
  };
}

const kinds = (hits: PrHit[], exerciseId = BENCH): PrKind[] =>
  hits.filter((h) => h.exerciseId === exerciseId).map((h) => h.kind);
const hit = (hits: PrHit[], kind: PrKind, exerciseId = BENCH): PrHit | undefined =>
  hits.find((h) => h.kind === kind && h.exerciseId === exerciseId);

describe("detectWorkoutPrs", () => {
  it("returns nothing for an unknown workout", () => {
    expect(detectWorkoutPrs([s("w1", 0, 100, 5)], "nope")).toEqual([]);
  });

  it("skips an exercise's first session by default", () => {
    const sets = [s("w1", 0, 100, 5), s("w1", 0, 100, 5)];
    expect(detectWorkoutPrs(sets, "w1")).toEqual([]);
  });

  it("reports first-session records with previous null when asked", () => {
    const sets = [s("w1", 0, 100, 5), s("w1", 0, 90, 8)];
    const hits = detectWorkoutPrs(sets, "w1", { skipFirstSession: false });
    // no rep pr: nothing was done at these weights before
    expect(kinds(hits)).toEqual(["e1rm", "weight", "volume"]);
    for (const h of hits) expect(h.previous).toBeNull();
    expect(hit(hits, "e1rm")?.value).toBeCloseTo(100 * (1 + 5 / 30));
    expect(hit(hits, "e1rm")?.set).toEqual({ weight: 100, unit: "kg", reps: 5 });
    expect(hit(hits, "weight")).toMatchObject({ value: 100, set: { weight: 100, unit: "kg", reps: 5 } });
    expect(hit(hits, "volume")).toMatchObject({ value: 100 * 5 + 90 * 8, set: null });
  });

  it("finds every kind when a session beats all prior work", () => {
    const sets = [
      s("w1", 0, 100, 5),
      s("w1", 0, 100, 5),
      s("w2", 7, 105, 5),
      s("w2", 7, 100, 7),
      s("w2", 7, 100, 6),
    ];
    const hits = detectWorkoutPrs(sets, "w2");
    expect(kinds(hits)).toEqual(["e1rm", "weight", "reps_at_weight", "volume"]);
    expect(hit(hits, "e1rm")).toMatchObject({ previous: 100 * (1 + 5 / 30), set: { weight: 100, reps: 7 } });
    expect(hit(hits, "e1rm")?.value).toBeCloseTo(100 * (1 + 7 / 30));
    expect(hit(hits, "weight")).toMatchObject({ value: 105, previous: 100, set: { weight: 105, reps: 5 } });
    expect(hit(hits, "reps_at_weight")).toEqual({
      exerciseId: BENCH,
      kind: "reps_at_weight",
      value: 7,
      previous: 5,
      set: { weight: 100, unit: "kg", reps: 7 },
      atWeightKg: 100,
    });
    expect(hit(hits, "volume")).toMatchObject({ value: 525 + 700 + 600, previous: 1000 });
  });

  it("ties are not prs", () => {
    const sets = [s("w1", 0, 100, 5), s("w1", 0, 80, 10), s("w2", 3, 100, 5), s("w2", 3, 80, 10)];
    expect(detectWorkoutPrs(sets, "w2")).toEqual([]);
  });

  it("compares against the best prior session, not just the last", () => {
    const sets = [s("w1", 0, 120, 3), s("w2", 3, 100, 5), s("w3", 6, 110, 3)];
    const hits = detectWorkoutPrs(sets, "w3");
    // 110 beats w2's 100 but not w1's 120
    expect(kinds(hits)).not.toContain("weight");
    expect(kinds(hits)).toEqual([]);
  });

  it("ignores later workouts", () => {
    const sets = [s("w1", 0, 100, 5), s("w2", 3, 105, 5), s("w3", 6, 200, 5)];
    expect(hit(detectWorkoutPrs(sets, "w2"), "weight")).toMatchObject({ value: 105, previous: 100 });
  });

  it("orders same-start workouts by id and never counts the workout itself", () => {
    const sets = [s("a", 0, 100, 5), s("b", 0, 110, 5)];
    expect(hit(detectWorkoutPrs(sets, "b"), "weight")).toMatchObject({ value: 110, previous: 100 });
    // "a" sorts first, so "b" is not before it: a's first session, skipped
    expect(detectWorkoutPrs(sets, "a")).toEqual([]);
    expect(hit(detectWorkoutPrs(sets, "a", { skipFirstSession: false }), "weight")?.previous).toBeNull();
  });

  it("only counts completed working sets", () => {
    const sets = [
      s("w1", 0, 100, 5),
      // prior junk that must not raise the bar
      s("w1", 0, 140, 5, { completed: false }),
      s("w1", 0, 140, 5, { kind: "warmup" }),
      s("w2", 3, 102, 5),
      // current junk that must not count
      s("w2", 3, 150, 5, { completed: false }),
      s("w2", 3, 150, 5, { kind: "warmup" }),
    ];
    const hits = detectWorkoutPrs(sets, "w2");
    expect(hit(hits, "weight")).toMatchObject({ value: 102, previous: 100 });
    expect(hit(hits, "volume")).toMatchObject({ value: 510, previous: 500 });
  });

  it("drop and failure sets are working sets", () => {
    const sets = [s("w1", 0, 100, 5), s("w2", 3, 100, 6, { kind: "failure" }), s("w2", 3, 60, 10, { kind: "drop" })];
    const hits = detectWorkoutPrs(sets, "w2");
    expect(hit(hits, "reps_at_weight")).toMatchObject({ value: 6, previous: 5 });
    expect(hit(hits, "volume")?.value).toBe(1200);
  });

  it("compares across units in kg", () => {
    const sets = [s("w1", 0, 100, 5), s("w2", 3, 225, 5, { unit: "lb" }), s("w3", 6, 230, 1, { unit: "lb" })];
    const w2 = detectWorkoutPrs(sets, "w2");
    expect(hit(w2, "weight")?.value).toBeCloseTo(225 / LB_PER_KG);
    expect(hit(w2, "weight")?.set).toEqual({ weight: 225, unit: "lb", reps: 5 });
    expect(hit(w2, "weight")?.previous).toBe(100);
    // 230 lb (104.3 kg) beats 225 lb on weight but not on e1rm
    const w3 = detectWorkoutPrs(sets, "w3");
    expect(kinds(w3)).toEqual(["weight"]);
    expect(hit(w3, "weight")?.previous).toBeCloseTo(225 / LB_PER_KG);
  });

  it("matches rep prs at the same rounded kg weight across units", () => {
    // 45 lb and 20.41 kg round to the same 0.01 kg
    const kg = Math.round((45 / LB_PER_KG) * 100) / 100;
    const sets = [s("w1", 0, 45, 10, { unit: "lb" }), s("w1", 0, 60, 3), s("w2", 3, kg, 12)];
    const hits = detectWorkoutPrs(sets, "w2");
    expect(hit(hits, "reps_at_weight")).toMatchObject({ value: 12, previous: 10, atWeightKg: kg });
  });

  it("reports only the heaviest rep pr per exercise", () => {
    const sets = [
      s("w1", 0, 60, 8),
      s("w1", 0, 80, 5),
      s("w1", 0, 100, 3),
      s("w2", 3, 60, 10),
      s("w2", 3, 80, 6),
      s("w2", 3, 80, 7),
      s("w2", 3, 100, 3),
    ];
    const reps = detectWorkoutPrs(sets, "w2").filter((h) => h.kind === "reps_at_weight");
    expect(reps).toHaveLength(1);
    expect(reps[0]).toMatchObject({ value: 7, previous: 5, atWeightKg: 80, set: { weight: 80, reps: 7 } });
  });

  it("needs a prior set at that exact weight for a rep pr", () => {
    const sets = [s("w1", 0, 100, 5), s("w2", 3, 70, 20)];
    expect(kinds(detectWorkoutPrs(sets, "w2"))).not.toContain("reps_at_weight");
  });

  it("same weight with more reps is not a weight pr", () => {
    const sets = [s("w1", 0, 100, 5), s("w2", 3, 100, 6)];
    const hits = detectWorkoutPrs(sets, "w2");
    expect(kinds(hits)).toEqual(["e1rm", "reps_at_weight", "volume"]);
  });

  it("past 15 reps there's no e1rm, but weight and volume still count", () => {
    const sets = [s("w1", 0, 20, 20), s("w2", 3, 22, 20)];
    expect(kinds(detectWorkoutPrs(sets, "w2"))).toEqual(["weight", "volume"]);
  });

  it("unit-less loads read as lb and are left out of volume", () => {
    const sets = [s("w1", 0, 40, 5), s("w2", 3, 100, 5, { unit: null })];
    const hits = detectWorkoutPrs(sets, "w2");
    expect(hit(hits, "weight")).toMatchObject({ set: { weight: 100, unit: "lb", reps: 5 } });
    expect(hit(hits, "weight")?.value).toBeCloseTo(100 / LB_PER_KG);
    expect(kinds(hits)).not.toContain("volume");
  });

  it("bodyweight-only history counts as a session but sets no bar", () => {
    const sets = [s("w1", 0, null, 12, { unit: null }), s("w2", 3, 10, 8)];
    expect(detectWorkoutPrs(sets, "w2")).toEqual([
      expect.objectContaining({ kind: "e1rm", previous: null }),
      expect.objectContaining({ kind: "weight", previous: null, value: 10 }),
      expect.objectContaining({ kind: "volume", previous: null, value: 80 }),
    ]);
  });

  it("ignores assisted (negative) and zero loads", () => {
    const sets = [s("w1", 0, 20, 5), s("w2", 3, -40, 8), s("w2", 3, 0, 10)];
    expect(detectWorkoutPrs(sets, "w2")).toEqual([]);
  });

  it("handles several exercises independently, in workout order", () => {
    const sets = [
      s("w1", 0, 100, 5),
      s("w1", 0, 140, 5, { exerciseId: SQUAT }),
      s("w2", 3, 150, 5, { exerciseId: SQUAT }),
      s("w2", 3, 95, 5),
      s("w2", 3, 30, 10, { exerciseId: "curl-dumbbell" }),
    ];
    const hits = detectWorkoutPrs(sets, "w2");
    expect([...new Set(hits.map((h) => h.exerciseId))]).toEqual([SQUAT]);
    expect(kinds(hits, SQUAT)).toEqual(["e1rm", "weight", "volume"]);
    // curl's first session is skipped; bench went down
    expect(kinds(hits, "curl-dumbbell")).toEqual([]);
    const all = detectWorkoutPrs(sets, "w2", { skipFirstSession: false });
    expect(kinds(all, "curl-dumbbell")).toEqual(["e1rm", "weight", "volume"]);
    expect(all[0]?.exerciseId).toBe(SQUAT);
  });

  it("volume pr can come from more sets at a lighter weight", () => {
    const sets = [s("w1", 0, 100, 5), s("w1", 0, 100, 5), s("w2", 3, 80, 5), s("w2", 3, 80, 5), s("w2", 3, 80, 5)];
    const hits = detectWorkoutPrs(sets, "w2");
    expect(kinds(hits)).toEqual(["volume"]);
    expect(hit(hits, "volume")).toMatchObject({ value: 1200, previous: 1000 });
  });

  it("does not depend on input order", () => {
    const sets = [s("w2", 3, 105, 5), s("w1", 0, 100, 5), s("w2", 3, 100, 7)];
    const reversed = [...sets].reverse();
    expect(detectWorkoutPrs(reversed, "w2")).toEqual(detectWorkoutPrs(sets, "w2"));
  });
});
