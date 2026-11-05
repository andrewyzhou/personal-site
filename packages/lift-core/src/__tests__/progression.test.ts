import { describe, expect, it } from "vitest";
import {
  defaultRule,
  describeRule,
  failureStreak,
  formatTarget,
  nextTarget,
  parseRule,
  roundToIncrement,
  type ProgressionRule,
  type SessionSet,
} from "../progression";

const set = (weight: number | null, reps: number | null, over: Partial<SessionSet> = {}): SessionSet => ({
  kind: "normal",
  weight,
  unit: "lb",
  reps,
  completed: 1,
  ...over,
});
const sets = (weight: number, ...reps: number[]) => reps.map((r) => set(weight, r));

const linear: ProgressionRule = { kind: "linear", sets: 3, reps: 5 };
const double: ProgressionRule = { kind: "double", sets: 3, repsLo: 8, repsHi: 12, increment: 5 };

describe("linear", () => {
  it("adds the increment after hitting every set", () => {
    const t = nextTarget(linear, sets(185, 5, 5, 5), "lb");
    expect(t.weight).toBe(190);
    expect(t.reps).toBe(5);
    expect(t.action).toBe("increase");
    expect(t.reason).toBe("+5 lb: hit 3×5 last time");
    expect(t.sets).toHaveLength(3);
    expect(t.sets[0]).toEqual({ kind: "normal", weight: 190, unit: "lb", reps: 5, durationS: null, distanceM: null });
    expect(formatTarget(t)).toBe("190 lb × 5");
  });

  it("extra reps still count as a hit; warm-ups are ignored", () => {
    const t = nextTarget(linear, [set(95, 3, { kind: "warmup" }), ...sets(185, 6, 5, 7)], "lb");
    expect(t.weight).toBe(190);
  });

  it("repeats after a miss, with the streak in the reason", () => {
    const t = nextTarget(linear, sets(185, 5, 5, 4), "lb");
    expect(t.weight).toBe(185);
    expect(t.action).toBe("repeat");
    expect(t.reason).toBe("repeat: missed 3×5 (1 of 3)");
  });

  it("too few sets is a miss", () => {
    expect(nextTarget(linear, sets(185, 5, 5), "lb").action).toBe("repeat");
  });

  it("unchecked sets don't count", () => {
    const s = sets(185, 5, 5, 5);
    s[2] = { ...s[2]!, completed: 0 };
    expect(nextTarget(linear, s, "lb").action).toBe("repeat");
  });

  it("deloads 10% after three straight misses at the same weight", () => {
    const history = [sets(185, 5, 4, 4), sets(185, 5, 5, 3)];
    const t = nextTarget(linear, sets(185, 5, 4, 3), "lb", { history });
    expect(t.action).toBe("deload");
    // 166.5 -> nearest 5
    expect(t.weight).toBe(165);
    expect(t.reason).toBe("-10%: missed 3×5 3 times");
  });

  it("misses at a heavier weight before a deload don't count", () => {
    const history = [sets(200, 5, 4, 4), sets(200, 4, 4, 4)];
    const t = nextTarget(linear, sets(185, 5, 4, 3), "lb", { history });
    expect(t.action).toBe("repeat");
    expect(t.reason).toContain("1 of 3");
  });

  it("a success in between resets the streak", () => {
    const history = [sets(185, 5, 5, 5), sets(185, 4, 4, 4)];
    expect(failureStreak(linear, [sets(185, 5, 5, 4), ...history], "lb")).toBe(1);
  });

  it("configurable deload: after 2, by 20%, in kg", () => {
    const rule: ProgressionRule = { kind: "linear", sets: 3, reps: 5, deloadAfter: 2, deloadPct: 20 };
    const kg = (w: number, ...reps: number[]) => reps.map((r) => set(w, r, { unit: "kg" }));
    const t = nextTarget(rule, kg(100, 5, 5, 4), "kg", { history: [kg(100, 4, 4, 4)] });
    expect(t.action).toBe("deload");
    expect(t.weight).toBe(80);
    expect(t.unit).toBe("kg");
  });

  it("deloadAfter 0 never deloads", () => {
    const rule: ProgressionRule = { ...linear, deloadAfter: 0 };
    const fails = Array.from({ length: 6 }, () => sets(185, 3, 3, 3));
    const t = nextTarget(rule, fails[0]!, "lb", { history: fails.slice(1) });
    expect(t.action).toBe("repeat");
    expect(t.reason).toBe("repeat: missed 3×5");
  });

  it("kg default increment is 2.5", () => {
    const t = nextTarget(linear, sets(100, 5, 5, 5).map((s) => ({ ...s, unit: "kg" as const })), "kg");
    expect(t.weight).toBe(102.5);
    expect(t.reason).toBe("+2.5 kg: hit 3×5 last time");
  });

  it("converts last session's unit into the caller's", () => {
    const t = nextTarget(linear, sets(100, 5, 5, 5).map((s) => ({ ...s, unit: "kg" as const })), "lb");
    expect(t.unit).toBe("lb");
    expect(t.weight).toBeCloseTo(225.462, 2);
  });

  it("first session: no weight, or the start weight", () => {
    expect(nextTarget(linear, [], "lb")).toMatchObject({ action: "start", weight: null, reps: 5, reason: "first session: pick a weight" });
    expect(nextTarget(linear, [], "lb", { startWeight: 135 })).toMatchObject({ weight: 135, reason: "start at 135 lb" });
  });

  it("back-off sets below the top weight are not the progressed lift", () => {
    const t = nextTarget(linear, [...sets(185, 5, 5, 5), set(135, 4)], "lb");
    expect(t.weight).toBe(190);
  });

  it("custom increment", () => {
    expect(nextTarget({ ...linear, increment: 10 }, sets(315, 5, 5, 5), "lb").weight).toBe(325);
  });
});

describe("double progression", () => {
  it("adds weight and resets to the bottom when every set hits the top", () => {
    const t = nextTarget(double, sets(50, 12, 12, 12), "lb");
    expect(t).toMatchObject({ weight: 55, reps: 8, action: "increase", reason: "+5 lb: hit 3×12 last time" });
  });

  it("inside the range: same weight, one more rep than the weakest set", () => {
    const t = nextTarget(double, sets(50, 10, 9, 9), "lb");
    expect(t).toMatchObject({ weight: 50, reps: 10, action: "repeat", reason: "same weight: build to 3×12" });
  });

  it("caps the rep target at the top", () => {
    expect(nextTarget(double, sets(50, 12, 12, 11), "lb").reps).toBe(12);
  });

  it("below the bottom counts as a miss and can deload", () => {
    const miss = sets(50, 8, 7, 6);
    expect(nextTarget(double, miss, "lb").reason).toBe("repeat: missed 3×8 (1 of 3)");
    const t = nextTarget(double, miss, "lb", { history: [miss, miss] });
    expect(t.action).toBe("deload");
    expect(t.weight).toBe(45);
  });
});

describe("percent of e1rm", () => {
  const rule: ProgressionRule = { kind: "percent", sets: 5, reps: 3, percent: 80 };

  it("uses the given e1rm, rounded to the increment", () => {
    const t = nextTarget(rule, [], "lb", { e1rm: 300 });
    expect(t).toMatchObject({ weight: 240, reps: 3, action: "percent", reason: "80% of 300 lb e1rm" });
    expect(t.sets).toHaveLength(5);
  });

  it("rounds to plate steps", () => {
    expect(nextTarget(rule, [], "lb", { e1rm: 287 }).weight).toBe(230);
    expect(nextTarget({ ...rule, increment: 2.5 }, [], "lb", { e1rm: 287 }).weight).toBe(230);
    expect(nextTarget(rule, [], "kg", { e1rm: 141 }).weight).toBe(112.5);
  });

  it("estimates the e1rm from the sessions when none is given", () => {
    // 225 x 5 -> 262.5 epley; 80% -> 210
    const t = nextTarget(rule, sets(225, 5), "lb");
    expect(t.weight).toBe(210);
  });

  it("no e1rm at all", () => {
    expect(nextTarget(rule, [], "lb").action).toBe("start");
  });

  it("never deloads", () => {
    expect(failureStreak(rule, [sets(100, 1)], "lb")).toBe(0);
  });
});

describe("helpers", () => {
  it("roundToIncrement", () => {
    expect(roundToIncrement(187.4, 5)).toBe(185);
    expect(roundToIncrement(187.5, 5)).toBe(190);
    expect(roundToIncrement(101.2, 2.5)).toBe(100);
    expect(roundToIncrement(101.3, 1.25)).toBe(101.25);
    expect(roundToIncrement(101.3, 0)).toBe(101.3);
  });

  it("formatTarget without a weight", () => {
    expect(formatTarget({ weight: null, reps: 8, unit: "lb" })).toBe("8 reps");
  });

  it("describeRule", () => {
    expect(describeRule(linear, "lb")).toBe("linear +5 lb · 3×5");
    expect(describeRule(double, "kg")).toBe("double +5 kg · 3×8-12");
    expect(describeRule({ kind: "percent", sets: 5, reps: 3, percent: 80 }, "lb")).toBe("80% e1rm · 5×3");
  });

  it("parseRule round-trips the defaults and rejects junk", () => {
    for (const k of ["linear", "double", "percent"] as const) expect(parseRule(JSON.parse(JSON.stringify(defaultRule(k))))).toEqual(defaultRule(k));
    expect(parseRule({ kind: "double", sets: 3, repsLo: 12, repsHi: 8 })).toBeNull();
    expect(parseRule({ kind: "linear", sets: 0, reps: 5 })).toBeNull();
    expect(parseRule({ kind: "nope", sets: 3, reps: 5 })).toBeNull();
    expect(parseRule(null)).toBeNull();
    expect(parseRule({ kind: "linear", sets: 3, reps: 5, increment: -1, deloadAfter: 2 })).toEqual({ kind: "linear", sets: 3, reps: 5, deloadAfter: 2 });
  });
});
