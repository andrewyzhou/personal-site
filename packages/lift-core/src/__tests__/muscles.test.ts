import { describe, expect, it } from "vitest";
import { MUSCLE_REGION_LABELS, MUSCLE_REGIONS, computeMuscleLoad, muscleLoadForExercises } from "../muscles";
import type { Exercise } from "../types";

describe("computeMuscleLoad", () => {
  it("returns empty objects for no input", () => {
    expect(computeMuscleLoad([])).toEqual({ raw: {}, normalized: {} });
  });

  it("weights primary 1.0 and secondary 0.5 and normalizes by the max", () => {
    const load = computeMuscleLoad([
      { exercise: { primary: ["chest"], secondary: ["front_delts", "triceps"] }, workingSets: 4 },
      { exercise: { primary: ["triceps"], secondary: [] }, workingSets: 3 },
    ]);
    expect(load.raw).toEqual({ chest: 4, front_delts: 2, triceps: 5 });
    expect(load.normalized).toEqual({ chest: 0.8, front_delts: 0.4, triceps: 1 });
  });

  it("omits regions with no load and ignores zero/negative set counts", () => {
    const load = computeMuscleLoad([
      { exercise: { primary: ["quads"], secondary: ["glutes"] }, workingSets: 0 },
      { exercise: { primary: ["calves"], secondary: [] }, workingSets: -2 },
    ]);
    expect(load).toEqual({ raw: {}, normalized: {} });
  });
});

describe("muscleLoadForExercises", () => {
  it("looks exercises up by id and skips unknown ids", () => {
    const load = muscleLoadForExercises([
      { exerciseId: "lateral-raise-dumbbell", workingSets: 4 },
      { exerciseId: "face-pull-cable", workingSets: 2 },
      { exerciseId: "does-not-exist", workingSets: 10 },
    ]);
    expect(load.raw.side_delts).toBe(4 + 1);
    expect(load.raw.rear_delts).toBe(2);
    expect(load.normalized.side_delts).toBe(1);
    expect(load.raw.front_delts).toBeUndefined();
  });

  it("accepts a custom catalog", () => {
    const custom: Exercise = {
      id: "neck-harness",
      name: "Neck Harness",
      equipment: "other",
      category: "strength",
      tracking: "weight_reps",
      primary: ["neck"],
      secondary: ["traps"],
      aliases: [],
      curated: false,
    };
    expect(muscleLoadForExercises([{ exerciseId: "neck-harness", workingSets: 2 }], [custom]).raw).toEqual({
      neck: 2,
      traps: 1,
    });
  });
});

describe("labels", () => {
  it("labels every region", () => {
    expect(Object.keys(MUSCLE_REGION_LABELS).sort()).toEqual([...MUSCLE_REGIONS].sort());
    expect(MUSCLE_REGION_LABELS.front_delts).toBe("front delts");
    expect(MUSCLE_REGIONS).toHaveLength(20);
  });
});
