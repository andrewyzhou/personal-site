import { describe, expect, it } from "vitest";
import type { HistorySet } from "lift-core";
import { bestSetsByE1rm, noteTimeline } from "../records";
import { betterSet, summarize, summaryMuscleLoad, type SummarySet } from "../summary";

const s = (weight: number | null, reps: number | null, extra: Partial<SummarySet> = {}): SummarySet => ({
  kind: "normal",
  weight,
  unit: "kg",
  reps,
  completed: 1,
  ...extra,
});

describe("summarize", () => {
  const out = summarize({
    startedAt: 1_000,
    endedAt: 1_000 + 3_600_000,
    exercises: [
      { exerciseId: "bench", sets: [s(60, 10, { kind: "warmup" }), s(100, 5), s(105, 3), s(110, 1, { completed: 0 })] },
      { exerciseId: "pullup", sets: [s(null, 10), s(null, 8)] },
      // a repeat entry merges into the first line
      { exerciseId: "bench", sets: [s(225, 2, { unit: "lb" })] },
    ],
  });

  it("totals completed working sets and volume", () => {
    expect(out.durationMs).toBe(3_600_000);
    expect(out.workingSets).toBe(5);
    expect(out.volumeKg).toBeCloseTo(500 + 315 + (225 / 2.2046226218) * 2);
  });

  it("one line per exercise with its best set by e1rm", () => {
    expect(out.exercises.map((e) => e.exerciseId)).toEqual(["bench", "pullup"]);
    const bench = out.exercises[0]!;
    expect(bench.workingSets).toBe(3);
    expect(bench.best).toMatchObject({ weight: 100, reps: 5 });
    expect(bench.best?.e1rmKg).toBeCloseTo(100 * (1 + 5 / 30));
    expect(out.exercises[1]).toMatchObject({ workingSets: 2, volumeKg: 0, best: null });
  });

  it("null duration while still open; clock skew clamps to 0", () => {
    expect(summarize({ startedAt: 5, endedAt: null, exercises: [] }).durationMs).toBeNull();
    expect(summarize({ startedAt: 5, endedAt: 1, exercises: [] }).durationMs).toBe(0);
  });
});

describe("betterSet", () => {
  it("prefers an e1rm, then load, then reps", () => {
    const a = { weight: 100, unit: "kg" as const, reps: 20, e1rmKg: null };
    const b = { weight: 80, unit: "kg" as const, reps: 5, e1rmKg: 93 };
    expect(betterSet(b, a)).toBe(true);
    expect(betterSet(a, b)).toBe(false);
    expect(betterSet(a, { ...a, reps: 18 })).toBe(true);
  });
});

describe("summaryMuscleLoad", () => {
  it("weights primary over secondary and skips unknown exercises", () => {
    const lookup = (id: string) =>
      id === "bench" ? { primary: ["chest" as const], secondary: ["triceps" as const] } : undefined;
    const load = summaryMuscleLoad(
      [
        { exerciseId: "bench", workingSets: 4 },
        { exerciseId: "mystery", workingSets: 9 },
      ],
      lookup
    );
    expect(load.raw).toEqual({ chest: 4, triceps: 2 });
    expect(load.normalized).toEqual({ chest: 1, triceps: 0.5 });
  });
});

describe("bestSetsByE1rm", () => {
  const h = (workoutId: string, startedAt: number, weight: number, reps: number, extra: Partial<HistorySet> = {}): HistorySet => ({
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

  it("ranks by e1rm, dedupes repeats to the first time, caps at n", () => {
    const rows = [
      h("a", 1, 100, 5),
      h("b", 2, 100, 5),
      h("b", 2, 110, 1),
      h("c", 3, 90, 8),
      h("c", 3, 80, 20), // past the e1rm rep range
      h("d", 4, 200, 1, { kind: "warmup" }),
      h("d", 4, 200, 1, { completed: false }),
      h("e", 5, 50, 5),
      h("e", 5, 60, 5),
      h("e", 5, 70, 5),
    ];
    const top = bestSetsByE1rm(rows, "bench", 5);
    expect(top.map((t) => `${t.weight}x${t.reps}@${t.workoutId}`)).toEqual([
      "100x5@a",
      "90x8@c",
      "110x1@b",
      "70x5@e",
      "60x5@e",
    ]);
  });
});

describe("noteTimeline", () => {
  it("newest first, skips blanks, card note before set notes", () => {
    const out = noteTimeline([
      { workoutId: "old", startedAt: 1, exerciseNote: "elbow ok", setNotes: [] },
      {
        workoutId: "new",
        startedAt: 2,
        exerciseNote: "  ",
        setNotes: [
          { setNumber: 2, text: "grip slipped" },
          { setNumber: 3, text: " " },
        ],
      },
    ]);
    expect(out).toEqual([
      { workoutId: "new", startedAt: 2, label: "set 2", text: "grip slipped" },
      { workoutId: "old", startedAt: 1, label: "exercise", text: "elbow ok" },
    ]);
  });
});
