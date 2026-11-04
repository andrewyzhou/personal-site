import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { e1rm, fromKg, isWorkingSet, LB_PER_KG, setVolumeKg, summarizeWorkout, toKg } from "../math";
import { parseShareText } from "../parse-share-text";
import type { ParsedSet, ParsedWorkout } from "../types";

function set(over: Partial<ParsedSet>): ParsedSet {
  return {
    position: 0,
    kind: "normal",
    label: 1,
    weight: null,
    unit: null,
    reps: null,
    durationS: null,
    distance: null,
    distanceUnit: null,
    rpe: null,
    bodyweight: false,
    note: null,
    raw: "",
    ...over,
  };
}

function workout(exercises: { name: string; sets: Partial<ParsedSet>[] }[]): ParsedWorkout {
  return {
    title: "t",
    startedLocal: null,
    exercises: exercises.map((e) => ({ name: e.name, notes: [], sets: e.sets.map((s, i) => set({ position: i, ...s })) })),
    notes: [],
    link: null,
    linkSlug: null,
    warnings: [],
  };
}

describe("unit conversion", () => {
  it("converts lb and kg", () => {
    expect(toKg(100, "kg")).toBe(100);
    expect(toKg(LB_PER_KG * 100, "lb")).toBeCloseTo(100, 10);
    expect(fromKg(100, "lb")).toBeCloseTo(220.46226218, 8);
    expect(fromKg(100, "kg")).toBe(100);
    expect(fromKg(toKg(225, "lb"), "lb")).toBeCloseTo(225, 10);
  });
});

describe("e1rm", () => {
  it("uses epley by default", () => {
    expect(e1rm(100, 5)).toBeCloseTo(116.6667, 4);
    expect(e1rm(100, 10, "epley")).toBeCloseTo(133.3333, 4);
  });

  it("supports brzycki", () => {
    expect(e1rm(100, 5, "brzycki")).toBeCloseTo(112.5, 6);
    expect(e1rm(100, 10, "brzycki")).toBeCloseTo(133.3333, 4);
  });

  it("returns the weight for a single", () => {
    expect(e1rm(140, 1)).toBe(140);
    expect(e1rm(140, 1, "brzycki")).toBe(140);
  });

  it("returns null when not computable", () => {
    expect(e1rm(100, 0)).toBeNull();
    expect(e1rm(100, -1)).toBeNull();
    expect(e1rm(0, 5)).toBeNull();
    expect(e1rm(-20, 5)).toBeNull();
    expect(e1rm(100, 16)).toBeNull();
    expect(e1rm(100, 15)).toBeCloseTo(150, 6);
    expect(e1rm(Number.NaN, 5)).toBeNull();
  });
});

describe("isWorkingSet / setVolumeKg", () => {
  it("excludes only warm-ups", () => {
    expect(isWorkingSet({ kind: "warmup" })).toBe(false);
    expect(isWorkingSet({ kind: "normal" })).toBe(true);
    expect(isWorkingSet({ kind: "drop" })).toBe(true);
    expect(isWorkingSet({ kind: "failure" })).toBe(true);
  });

  it("computes kg volume for weighted working sets", () => {
    expect(setVolumeKg(set({ weight: 100, unit: "kg", reps: 5 }))).toBe(500);
    expect(setVolumeKg(set({ weight: 225, unit: "lb", reps: 5 }))).toBeCloseTo((225 / LB_PER_KG) * 5, 8);
    expect(setVolumeKg(set({ weight: 25, unit: "lb", reps: 8, bodyweight: true }))).toBeCloseTo((25 / LB_PER_KG) * 8, 8);
  });

  it("is zero for warm-ups, assisted, reps-only and timed sets", () => {
    expect(setVolumeKg(set({ kind: "warmup", weight: 100, unit: "kg", reps: 5 }))).toBe(0);
    expect(setVolumeKg(set({ weight: -40, unit: "lb", reps: 10, bodyweight: true }))).toBe(0);
    expect(setVolumeKg(set({ reps: 12, bodyweight: true }))).toBe(0);
    expect(setVolumeKg(set({ durationS: 90 }))).toBe(0);
    expect(setVolumeKg(set({ weight: 70, unit: "lb", distance: 40, distanceUnit: "m" }))).toBe(0);
    expect(setVolumeKg(set({ weight: 100, unit: null, reps: 5 }))).toBe(0);
  });
});

describe("summarizeWorkout", () => {
  it("summarizes the us push day fixture", () => {
    const text = readFileSync(path.join(__dirname, "fixtures", "share-text", "us-push-day.txt"), "utf8");
    const s = summarizeWorkout(parseShareText(text));
    expect(s.exerciseCount).toBe(7);
    expect(s.unit).toBe("lb");

    const bench = s.exercises[0];
    expect(bench.name).toBe("Bench Press (Barbell)");
    expect(bench.workingSets).toBe(3);
    expect(bench.volumeKg).toBeCloseTo((185 * 5 + 185 * 5 + 165 * 8) / LB_PER_KG, 8);
    expect(bench.topSet).toEqual({ weight: 185, unit: "lb", reps: 5 });
    // 185x5 (~216) beats the 165x8 drop set (~209)
    expect(bench.bestE1rmKg).toBeCloseTo(e1rm(185 / LB_PER_KG, 5)!, 8);

    const pull = s.exercises[2];
    expect(pull.workingSets).toBe(2);
    expect(pull.topSet).toEqual({ weight: 25, unit: "lb", reps: 8 });

    const dip = s.exercises[3];
    expect(dip.volumeKg).toBe(0);
    expect(dip.topSet).toBeNull();
    expect(dip.bestE1rmKg).toBeNull();

    expect(s.exercises[4].topSet).toBeNull();
    expect(s.workingSets).toBe(3 + 2 + 2 + 1 + 1 + 1 + 1);
    expect(s.volumeKg).toBeCloseTo(
      s.exercises.reduce((a, e) => a + e.volumeKg, 0),
      8,
    );
  });

  it("breaks top-set ties by reps and compares across units", () => {
    const s = summarizeWorkout(
      workout([
        {
          name: "a",
          sets: [
            { weight: 100, unit: "kg", reps: 3 },
            { weight: 100, unit: "kg", reps: 5 },
            { weight: 100, unit: "kg", reps: 4 },
            { kind: "warmup", weight: 200, unit: "kg", reps: 1 },
          ],
        },
        {
          name: "b",
          sets: [
            { weight: 225, unit: "lb", reps: 5 },
            { weight: 105, unit: "kg", reps: 2 },
          ],
        },
      ]),
    );
    expect(s.exercises[0].topSet).toEqual({ weight: 100, unit: "kg", reps: 5 });
    expect(s.exercises[0].workingSets).toBe(3);
    expect(s.exercises[1].topSet).toEqual({ weight: 105, unit: "kg", reps: 2 });
  });

  it("picks the most common unit, lb on a tie or none", () => {
    const kg = workout([{ name: "a", sets: [{ weight: 1, unit: "kg", reps: 1 }, { weight: 1, unit: "kg", reps: 1 }, { weight: 1, unit: "lb", reps: 1 }] }]);
    expect(summarizeWorkout(kg).unit).toBe("kg");
    const tie = workout([{ name: "a", sets: [{ weight: 1, unit: "kg", reps: 1 }, { weight: 1, unit: "lb", reps: 1 }] }]);
    expect(summarizeWorkout(tie).unit).toBe("lb");
    const none = workout([{ name: "a", sets: [{ reps: 10 }, { durationS: 60 }] }]);
    expect(summarizeWorkout(none).unit).toBe("lb");
  });

  it("handles an empty workout", () => {
    expect(summarizeWorkout(workout([]))).toEqual({
      exerciseCount: 0,
      workingSets: 0,
      volumeKg: 0,
      unit: "lb",
      exercises: [],
    });
  });
});
