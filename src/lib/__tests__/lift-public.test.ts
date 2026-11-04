import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrHit } from "lift-core";

// pr detection lives in lift-core and may throw while it's being built; the
// serializer has to treat that as "no prs"
const { detect } = vi.hoisted(() => ({ detect: vi.fn() }));
vi.mock("lift-core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("lift-core")>()),
  detectWorkoutPrs: (...args: unknown[]) => detect(...args),
}));

// thenable query-chain stub (same idea as public-leaks.test.ts)
const { queue, mockDb } = vi.hoisted(() => {
  const queue: unknown[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {};
  for (const m of ["select", "from", "where", "orderBy", "limit", "innerJoin", "leftJoin"]) chain[m] = () => chain;
  chain.then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
    const next = queue.shift();
    if (next instanceof Error) reject(next);
    else resolve(next ?? []);
  };
  return { queue, mockDb: chain };
});
vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  getDb: () => mockDb,
}));

import {
  coarsenLocalTime,
  formatEffort,
  formatLoad,
  groupSets,
  isLiftOnlyPublic,
  isPublishableWorkout,
  isValidLiftId,
  liftCalendarId,
  loadActivityLiftWorkouts,
  publicLiftCalendarEntry,
  safeWorkoutPrs,
  sanitizeMuscleLoad,
  serializeLiftWorkout,
  topRegions,
  type LiftExerciseInput,
  type LiftSetInput,
  type LiftWorkoutInput,
} from "@/lib/lift/public";

const SECRET = "PRIVATE-NOTE-SENTINEL";

function workout(over: Partial<LiftWorkoutInput> = {}): LiftWorkoutInput {
  return {
    id: "strong-abc",
    title: "Full Body B",
    startedLocal: "2026-11-02T19:18",
    durationS: null,
    status: "finished",
    deletedAt: null,
    muscleLoad: { glutes: 1, quads: 0.75, hamstrings: 0.75, biceps: 0.5 },
    ...over,
  };
}

function ex(i: number, exerciseId: string, over: Partial<LiftExerciseInput> = {}): LiftExerciseInput {
  return { id: `strong-abc:${i}`, exerciseId, position: i, nameRaw: exerciseId, customName: null, ...over };
}

let pos = 0;
function set(exIndex: number, over: Partial<LiftSetInput> = {}): LiftSetInput {
  return {
    workoutExerciseId: `strong-abc:${exIndex}`,
    position: pos++,
    kind: "normal",
    weight: 185,
    unit: "lb",
    reps: 5,
    durationS: null,
    distanceM: null,
    bodyweight: false,
    completed: true,
    ...over,
  };
}

beforeEach(() => {
  pos = 0;
  detect.mockReset();
  detect.mockImplementation(() => {
    throw new Error("not implemented");
  });
  queue.length = 0;
});

describe("set formatting + grouping", () => {
  it("collapses identical consecutive sets", () => {
    const g = groupSets([set(0), set(0), set(0), set(0, { weight: 205, reps: 3 })]);
    expect(g.map((x) => x.label)).toEqual(["3×5 @ 185 lb", "1×3 @ 205 lb"]);
  });

  it("doesn't merge across kinds or non-adjacent repeats", () => {
    const g = groupSets([set(0), set(0, { kind: "drop" }), set(0)]);
    expect(g.map((x) => x.label)).toEqual(["1×5 @ 185 lb", "1×5 @ 185 lb · drop", "1×5 @ 185 lb"]);
    expect(groupSets([set(0, { kind: "failure" })])[0].label).toBe("1×5 @ 185 lb · to failure");
  });

  it("formats bodyweight, weighted, assisted, kg and decimals", () => {
    expect(formatLoad({ weight: null, unit: null, bodyweight: true })).toBeNull();
    expect(formatLoad({ weight: 25, unit: "lb", bodyweight: true })).toBe("+25 lb");
    expect(formatLoad({ weight: -40, unit: "lb", bodyweight: true })).toBe("-40 lb");
    expect(formatLoad({ weight: 62.5, unit: "kg", bodyweight: false })).toBe("62.5 kg");
    expect(formatLoad({ weight: 1000, unit: null, bodyweight: false })).toBe("1,000 lb");
    expect(groupSets([set(0, { weight: null, unit: null, bodyweight: true, reps: 12 })])[0].label).toBe("1×12");
  });

  it("formats duration and distance sets", () => {
    expect(formatEffort({ reps: null, durationS: 60, distanceM: null })).toBe("1:00");
    expect(formatEffort({ reps: null, durationS: 90, distanceM: 400 })).toBe("400 m in 1:30");
    expect(formatEffort({ reps: null, durationS: null, distanceM: 1609.344 })).toBe("1 mi");
    expect(formatEffort({ reps: null, durationS: null, distanceM: null })).toBe("—");
  });
});

describe("serializeLiftWorkout", () => {
  const exercises = [ex(0, "squat-barbell"), ex(1, "custom-1234", { customName: "Sled Push", nameRaw: "sled push" })];
  const sets = () => [
    set(0, { kind: "warmup", weight: 45, reps: 6 }),
    set(0, { kind: "warmup", weight: 135, reps: 4 }),
    set(0),
    set(0),
    set(0),
    set(0, { weight: 205, reps: 3 }),
    set(0, { weight: 225, reps: 1, completed: false }),
    set(1, { weight: 90, reps: 10 }),
  ];

  it("builds the public view", () => {
    const w = serializeLiftWorkout(workout(), exercises, sets())!;
    expect(w.title).toBe("Full Body B");
    expect(w.date).toBe("2026-11-02");
    expect(w.startTime).toBe("19:18");
    expect(w.workingSets).toBe(5);
    // 3*185*5 + 205*3 + 90*10 = 2775 + 615 + 900 (lb, round-tripped through kg)
    expect(w.volumeLb).toBe(4290);
    const [squat, sled] = w.exercises;
    expect(squat.name).toBe("Squat (Barbell)");
    expect(squat.working.map((g) => g.label)).toEqual(["3×5 @ 185 lb", "1×3 @ 205 lb"]);
    expect(squat.warmups.map((g) => g.label)).toEqual(["1×6 @ 45 lb", "1×4 @ 135 lb"]);
    expect(squat.topSet).toBe("205 lb × 3");
    // epley: 205 * (1 + 3/30) = 225.5; 185 * (1 + 5/30) = 215.8
    expect(squat.bestE1rm).toBe("226 lb");
    // custom exercises take their name from the exercises table
    expect(sled.name).toBe("Sled Push");
    expect(w.topRegions.slice(0, 1)).toEqual(["glutes"]);
    expect(w.prs).toEqual([]);
  });

  it("never publishes notes, even when handed full rows", () => {
    const fullWorkout = { ...workout(), notes: SECRET } as LiftWorkoutInput;
    const fullSets = sets().map((s) => ({ ...s, note: SECRET }));
    const fullEx = exercises.map((e) => ({ ...e, notes: SECRET }));
    const w = serializeLiftWorkout(fullWorkout, fullEx, fullSets);
    expect(JSON.stringify(w)).not.toContain(SECRET);
  });

  it("drops deleted, discarded and active workouts", () => {
    expect(serializeLiftWorkout(workout({ deletedAt: new Date() }), exercises, sets())).toBeNull();
    expect(serializeLiftWorkout(workout({ status: "discarded" }), exercises, sets())).toBeNull();
    expect(serializeLiftWorkout(workout({ status: "active" }), exercises, sets())).toBeNull();
  });

  it("coarsens the start time and can hide it", () => {
    expect(serializeLiftWorkout(workout(), exercises, sets(), { coarsenStartMin: 15 })!.startTime).toBe("19:15");
    expect(serializeLiftWorkout(workout(), exercises, sets(), { showTime: false })!.startTime).toBeNull();
    expect(coarsenLocalTime("07:59", 60)).toBe("07:00");
    expect(coarsenLocalTime("07:59", 0)).toBe("07:59");
  });

  it("falls back to a computed muscle load when the stored one is empty", () => {
    const w = serializeLiftWorkout(workout({ muscleLoad: {} }), [ex(0, "squat-barbell")], [set(0)])!;
    expect(w.topRegions.length).toBeGreaterThan(0);
    expect(Math.max(...Object.values(w.muscleLoad).map(Number))).toBe(1);
  });

  it("treats a throwing pr detector as no prs", () => {
    const history = [{ workoutId: "strong-abc", startedAt: 1, exerciseId: "squat-barbell", kind: "normal" as const, weight: 185, unit: "lb" as const, reps: 5, completed: true }];
    expect(safeWorkoutPrs(history, "strong-abc")).toEqual([]);
    expect(serializeLiftWorkout(workout(), exercises, sets(), { history })!.prs).toEqual([]);
  });

  it("labels prs from the detector, once per exercise", () => {
    const hits: PrHit[] = [
      { exerciseId: "squat-barbell", kind: "weight", value: 93, previous: 84, set: { weight: 205, unit: "lb", reps: 3 } },
      { exerciseId: "squat-barbell", kind: "e1rm", value: 102.3, previous: 97.9, set: { weight: 205, unit: "lb", reps: 3 } },
      { exerciseId: "squat-barbell", kind: "reps_at_weight", value: 5, previous: 4, set: { weight: 185, unit: "lb", reps: 5 }, atWeightKg: 83.91 },
      { exerciseId: "squat-barbell", kind: "volume", value: 1537.6, previous: 1200, set: null },
      { exerciseId: "not-in-this-workout", kind: "e1rm", value: 50, previous: 40, set: null },
    ];
    detect.mockReturnValue(hits);
    const history = [{ workoutId: "strong-abc", startedAt: 1, exerciseId: "squat-barbell", kind: "normal" as const, weight: 185, unit: "lb" as const, reps: 5, completed: true }];
    const twice = [...exercises, ex(2, "squat-barbell")];
    const w = serializeLiftWorkout(workout(), twice, [...sets(), set(2)], { history })!;
    expect(detect).toHaveBeenCalledWith(history, "strong-abc");
    expect(w.exercises[0].prs.map((p) => p.label)).toEqual([
      "e1rm 226 lb",
      "heaviest 205 lb × 3",
      "5 reps @ 185 lb",
      "volume 3,390 lb",
    ]);
    expect(w.exercises[2].prs).toEqual([]);
    expect(w.prs).toHaveLength(4);
  });
});

describe("privacy filters", () => {
  it("publishable = finished and not deleted; lift-only = publishable without links", () => {
    expect(isPublishableWorkout({ deletedAt: null, status: "finished" })).toBe(true);
    expect(isPublishableWorkout({ deletedAt: new Date(), status: "finished" })).toBe(false);
    expect(isPublishableWorkout({ deletedAt: null, status: "discarded" })).toBe(false);
    expect(isLiftOnlyPublic({ deletedAt: null, status: "finished" }, 0)).toBe(true);
    expect(isLiftOnlyPublic({ deletedAt: null, status: "finished" }, 1)).toBe(false);
  });

  it("only url-safe ids reach a query", () => {
    expect(isValidLiftId("strong-caterxeu")).toBe(true);
    expect(isValidLiftId("8f14e45f-ceea-467f-a3b4-6c8e5f0a1b2c")).toBe(true);
    expect(isValidLiftId("")).toBe(false);
    expect(isValidLiftId("a b")).toBe(false);
    expect(isValidLiftId("../x")).toBe(false);
    expect(isValidLiftId("x".repeat(101))).toBe(false);
  });

  it("muscle load keeps known regions only, clamped and renormalized", () => {
    expect(sanitizeMuscleLoad({ glutes: 2, quads: 1, bogus: 5, abs: -1, calves: "x" })).toEqual({ glutes: 1, quads: 0.5 });
    expect(sanitizeMuscleLoad(null)).toEqual({});
    expect(topRegions({ quads: 0.5, glutes: 1, abs: 0.5 })).toEqual(["glutes", "abs", "quads"]);
  });
});

describe("loadActivityLiftWorkouts", () => {
  it("never queries for a private recording", async () => {
    queue.push(new Error("should not query"));
    expect(await loadActivityLiftWorkouts({ id: 1, hidden: true })).toEqual([]);
    expect(queue).toHaveLength(1);
  });

  it("one query and nothing else when the recording has no lifts", async () => {
    queue.push([], new Error("second query"));
    expect(await loadActivityLiftWorkouts({ id: 1, hidden: false })).toEqual([]);
    expect(queue).toHaveLength(1);
  });

  it("shows each linked workout once (any role) and drops deleted/discarded ones", async () => {
    const w = workout();
    queue.push(
      [w, w, workout({ id: "strong-del", deletedAt: new Date() }), workout({ id: "strong-dis", status: "discarded" })],
      [{ ...ex(0, "squat-barbell"), workoutId: "strong-abc" }],
      [{ ...set(0), workoutId: "strong-abc" }],
      [],
    );
    const out = await loadActivityLiftWorkouts({ id: 1, hidden: false });
    expect(out.map((x) => x.id)).toEqual(["strong-abc"]);
    // the recording header already shows its own coarsened time
    expect(out[0].startTime).toBeNull();
  });

  it("degrades to nothing when the lift tables fail", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    queue.push(new Error("column does not exist"));
    expect(await loadActivityLiftWorkouts({ id: 1, hidden: false })).toEqual([]);
  });
});

describe("calendar entries", () => {
  it("maps a lift-only workout to a WeightTraining entry with its own page", () => {
    const e = publicLiftCalendarEntry({ id: "strong-abc", title: "Push", startedLocal: "2026-11-02T19:18", durationS: 3600 }, 15);
    expect(e).toMatchObject({
      name: "Push",
      type: "WeightTraining",
      date: "2026-11-02",
      startTime: "19:15",
      duration: 3600,
      elapsedTime: 3600,
      averageHeartrate: null,
      description: null,
      href: "/lifts/strong-abc",
    });
    expect(e.id).toBeLessThan(0);
    expect(publicLiftCalendarEntry({ id: "strong-x", title: "", startedLocal: "2026-11-02T07:00", durationS: null }, 0).duration).toBe(0);
  });

  it("synthetic ids are stable, negative and distinct", () => {
    expect(liftCalendarId("strong-abc")).toBe(liftCalendarId("strong-abc"));
    const ids = new Set(Array.from({ length: 500 }, (_, i) => liftCalendarId(`strong-${i}`)));
    expect(ids.size).toBe(500);
    for (const id of ids) expect(id).toBeLessThan(0);
  });
});
