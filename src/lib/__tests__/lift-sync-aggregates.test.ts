import { describe, it, expect } from "vitest";
import { computeAggregates, type AggregateSetRow } from "@/lib/lift/sync/aggregates";

const row = (over: Partial<AggregateSetRow>): AggregateSetRow => ({
  workoutId: "w1",
  exerciseId: "bench-press-barbell",
  kind: "normal",
  weight: 100,
  unit: "kg",
  reps: 5,
  completed: true,
  ...over,
});

describe("computeAggregates", () => {
  it("counts completed working sets and their volume", () => {
    const out = computeAggregates(
      ["w1"],
      [
        row({}),
        row({ weight: 225, unit: "lb", reps: 5 }),
        row({ kind: "warmup" }),
        row({ completed: false }),
        row({ weight: null, reps: 10 }),
      ],
      []
    );
    const a = out.get("w1")!;
    expect(a.workingSets).toBe(3);
    expect(a.volumeKg).toBeCloseTo(500 + (225 / 2.2046226218) * 5, 1);
    expect(a.muscleLoad).toEqual({ chest: 1, front_delts: 0.5, triceps: 0.5 });
  });

  it("uses stored muscles for custom exercises", () => {
    const out = computeAggregates(
      [],
      [row({ workoutId: "w2", exerciseId: "custom-aaaaaaaaaaaa" })],
      [
        { exerciseId: "custom-aaaaaaaaaaaa", region: "glutes", role: "primary" },
        { exerciseId: "custom-aaaaaaaaaaaa", region: "hamstrings", role: "secondary" },
      ]
    );
    expect(out.get("w2")).toEqual({ workingSets: 1, volumeKg: 500, muscleLoad: { glutes: 1, hamstrings: 0.5 } });
  });

  it("zeros a touched workout with no sets left", () => {
    const out = computeAggregates(["w1", "w3"], [row({ workoutId: "w3", kind: null, weight: null, reps: null, completed: null })], []);
    expect(out.get("w1")).toEqual({ workingSets: 0, volumeKg: 0, muscleLoad: {} });
    expect(out.get("w3")).toEqual({ workingSets: 0, volumeKg: 0, muscleLoad: {} });
  });
});
