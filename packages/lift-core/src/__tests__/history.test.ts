import { describe, expect, it } from "vitest";
import { exerciseSessions, personalRecords, type HistorySet } from "../history";
import { LB_PER_KG } from "../math";

const DAY = 86_400_000;
const T0 = Date.UTC(2024, 0, 1);

function s(partial: Partial<HistorySet> & Pick<HistorySet, "workoutId">): HistorySet {
  return {
    startedAt: T0,
    exerciseId: "bench-press-barbell",
    kind: "normal",
    weight: 100,
    unit: "kg",
    reps: 5,
    completed: true,
    ...partial,
  };
}

const SETS: HistorySet[] = [
  // out of order on purpose: day 2 listed first
  s({ workoutId: "w2", startedAt: T0 + 2 * DAY, weight: 105, reps: 5 }),
  s({ workoutId: "w2", startedAt: T0 + 2 * DAY, weight: 110, reps: 3 }),
  s({ workoutId: "w2", startedAt: T0 + 2 * DAY, weight: 120, reps: 1, completed: false }),
  s({ workoutId: "w1", startedAt: T0, kind: "warmup", weight: 60, reps: 10 }),
  s({ workoutId: "w1", startedAt: T0, weight: 100, reps: 5 }),
  s({ workoutId: "w1", startedAt: T0, weight: 100, reps: 6 }),
  s({ workoutId: "w1", startedAt: T0, kind: "drop", weight: 70, reps: 10 }),
  s({ workoutId: "w1", startedAt: T0, exerciseId: "squat-barbell", weight: 200, reps: 5 }),
  s({ workoutId: "w3", startedAt: T0 + 5 * DAY, weight: 225, unit: "lb", reps: 4 }),
  s({ workoutId: "w4", startedAt: T0 + 7 * DAY, kind: "warmup", weight: 60, reps: 5 }),
];

describe("exerciseSessions", () => {
  const sessions = exerciseSessions(SETS, "bench-press-barbell");

  it("returns one point per workout with completed working sets, oldest first", () => {
    expect(sessions.map((p) => p.workoutId)).toEqual(["w1", "w2", "w3"]);
    expect(sessions.map((p) => p.startedAt)).toEqual([T0, T0 + 2 * DAY, T0 + 5 * DAY]);
  });

  it("counts working sets and their volume, ignoring warm-ups and incomplete sets", () => {
    const [w1, w2] = sessions;
    expect(w1.workingSets).toBe(3);
    expect(w1.volumeKg).toBeCloseTo(100 * 5 + 100 * 6 + 70 * 10, 9);
    expect(w2.workingSets).toBe(2);
    expect(w2.volumeKg).toBeCloseTo(105 * 5 + 110 * 3, 9);
  });

  it("picks the best e1rm and the heaviest set (more reps on a tie)", () => {
    const [w1, w2, w3] = sessions;
    expect(w1.e1rmKg).toBeCloseTo(100 * (1 + 6 / 30), 9);
    expect(w1.topSet).toEqual({ weight: 100, unit: "kg", reps: 6 });
    expect(w2.e1rmKg).toBeCloseTo(105 * (1 + 5 / 30), 9);
    expect(w2.topSet).toEqual({ weight: 110, unit: "kg", reps: 3 });
    // lb sets convert for comparison but print as logged
    expect(w3.topSet).toEqual({ weight: 225, unit: "lb", reps: 4 });
    expect(w3.e1rmKg).toBeCloseTo((225 / LB_PER_KG) * (1 + 4 / 30), 9);
    expect(w3.volumeKg).toBeCloseTo((225 / LB_PER_KG) * 4, 9);
  });

  it("keeps sessions with only unloaded working sets", () => {
    const pts = exerciseSessions(
      [
        s({ workoutId: "a", exerciseId: "pull-up", weight: null, unit: null, reps: 10 }),
        s({ workoutId: "a", exerciseId: "pull-up", weight: -20, unit: "kg", reps: 8 }),
        s({ workoutId: "a", exerciseId: "pull-up", weight: 0, unit: "kg", reps: 8 }),
      ],
      "pull-up",
    );
    expect(pts).toEqual([{ workoutId: "a", startedAt: T0, e1rmKg: null, volumeKg: 0, topSet: null, workingSets: 3 }]);
  });

  it("skips e1rm past 15 reps but still counts volume and top set", () => {
    const [p] = exerciseSessions([s({ workoutId: "a", weight: 40, reps: 20 })], "bench-press-barbell");
    expect(p.e1rmKg).toBeNull();
    expect(p.volumeKg).toBe(800);
    expect(p.topSet).toEqual({ weight: 40, unit: "kg", reps: 20 });
  });

  it("treats a unit-less load as lb for e1rm but adds no volume, like summarizeWorkout", () => {
    const [p] = exerciseSessions([s({ workoutId: "a", weight: 100, unit: null, reps: 1 })], "bench-press-barbell");
    expect(p.volumeKg).toBe(0);
    expect(p.e1rmKg).toBeCloseTo(100 / LB_PER_KG, 9);
    expect(p.topSet).toEqual({ weight: 100, unit: "lb", reps: 1 });
  });

  it("is empty for unknown exercises or no input", () => {
    expect(exerciseSessions(SETS, "nope")).toEqual([]);
    expect(exerciseSessions([], "bench-press-barbell")).toEqual([]);
  });
});

describe("personalRecords", () => {
  const pr = personalRecords(SETS, "bench-press-barbell");

  it("finds the best e1rm across sessions", () => {
    // 105x5 (122.5) beats 110x3 (121) and 225 lb x4 (~115.7)
    expect(pr.bestE1rmKg).toEqual({ value: 105 * (1 + 5 / 30), workoutId: "w2", startedAt: T0 + 2 * DAY });
  });

  it("finds the heaviest completed working set, ignoring the missed 120", () => {
    // 225 lb is ~102 kg, lighter than 110 kg
    expect(pr.heaviest).toEqual({ weight: 110, unit: "kg", reps: 3, workoutId: "w2", startedAt: T0 + 2 * DAY });
  });

  it("builds the rep pr table lightest first with the first time each was hit", () => {
    expect(pr.repsAtWeight).toEqual([
      { weightKg: 70, reps: 10, startedAt: T0 },
      { weightKg: 100, reps: 6, startedAt: T0 },
      { weightKg: Math.round((225 / LB_PER_KG) * 100) / 100, reps: 4, startedAt: T0 + 5 * DAY },
      { weightKg: 105, reps: 5, startedAt: T0 + 2 * DAY },
      { weightKg: 110, reps: 3, startedAt: T0 + 2 * DAY },
    ]);
  });

  it("gives ties to the earliest session", () => {
    const sets = [
      s({ workoutId: "late", startedAt: T0 + DAY, weight: 100, reps: 5 }),
      s({ workoutId: "early", startedAt: T0, weight: 100, reps: 5 }),
    ];
    const r = personalRecords(sets, "bench-press-barbell");
    expect(r.bestE1rmKg?.workoutId).toBe("early");
    expect(r.heaviest?.workoutId).toBe("early");
    expect(r.repsAtWeight).toEqual([{ weightKg: 100, reps: 5, startedAt: T0 }]);
  });

  it("merges the same load logged in different units", () => {
    const sets = [
      s({ workoutId: "a", startedAt: T0, weight: 100, unit: "kg", reps: 3 }),
      s({ workoutId: "b", startedAt: T0 + DAY, weight: 100 * LB_PER_KG, unit: "lb", reps: 4 }),
    ];
    const r = personalRecords(sets, "bench-press-barbell");
    expect(r.repsAtWeight).toEqual([{ weightKg: 100, reps: 4, startedAt: T0 + DAY }]);
    // equal load, more reps wins the heaviest slot
    expect(r.heaviest).toMatchObject({ workoutId: "b", unit: "lb", reps: 4 });
  });

  it("is empty when nothing qualifies", () => {
    const empty = { bestE1rmKg: null, heaviest: null, repsAtWeight: [] };
    expect(personalRecords([], "x")).toEqual(empty);
    expect(personalRecords([s({ workoutId: "a", kind: "warmup" }), s({ workoutId: "a", completed: false })], "bench-press-barbell")).toEqual(empty);
    expect(personalRecords([s({ workoutId: "a", weight: null, unit: null, reps: 12 })], "bench-press-barbell")).toEqual(empty);
  });
});
