import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
  loadLiftCalendar,
  publicLiftCalendarEntry,
  resolvePublicLiftId,
  safeWorkoutPrs,
  sanitizeMuscleLoad,
  serializeLiftWorkout,
  topRegions,
  type LiftExerciseInput,
  type LiftOnlyRow,
  type LiftSetInput,
  type LiftWorkoutInput,
} from "@/lib/lift/public";
import { isPublicLiftId, publicLiftId } from "@/lib/lift/public-id";

const SECRET = "PRIVATE-NOTE-SENTINEL";

function workout(over: Partial<LiftWorkoutInput> = {}): LiftWorkoutInput {
  return {
    id: "share-abc",
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
  return { id: `share-abc:${i}`, exerciseId, position: i, nameRaw: exerciseId, customName: null, ...over };
}

let pos = 0;
function set(exIndex: number, over: Partial<LiftSetInput> = {}): LiftSetInput {
  return {
    workoutExerciseId: `share-abc:${exIndex}`,
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

  it("keeps same-weight sets with different reps as their own rows", () => {
    const g = groupSets([set(0), set(0, { reps: 4 })]);
    expect(g.map((x) => x.label)).toEqual(["1×5 @ 185 lb", "1×4 @ 185 lb"]);
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
    expect(w.volume).toBe(4290);
    expect(w.volumeUnit).toBe("lb");
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

  it("reports volume in the unit most sets were logged in", () => {
    const kg = [set(0, { weight: 100, unit: "kg", reps: 5 }), set(0, { weight: 100, unit: "kg", reps: 5 }), set(1, { weight: 45, unit: "lb", reps: 10 })];
    const w = serializeLiftWorkout(workout(), exercises, kg)!;
    expect(w.volumeUnit).toBe("kg");
    // 1000 kg + 45 lb * 10 (204.1 kg)
    expect(w.volume).toBe(1204);
    const tie = serializeLiftWorkout(workout(), exercises, [set(0, { weight: 100, unit: "kg" }), set(1)])!;
    expect(tie.volumeUnit).toBe("lb");
  });

  it("never carries the internal workout id", () => {
    const w = serializeLiftWorkout(workout({ id: "share-caterxeu" }), exercises.map((e) => ({ ...e, id: e.id.replace("abc", "caterxeu") })), [])!;
    expect(JSON.stringify(w)).not.toContain("caterxeu");
    expect(w).not.toHaveProperty("id");
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
    const history = [{ workoutId: "share-abc", startedAt: 1, exerciseId: "squat-barbell", kind: "normal" as const, weight: 185, unit: "lb" as const, reps: 5, completed: true }];
    expect(safeWorkoutPrs(history, "share-abc")).toEqual([]);
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
    const history = [{ workoutId: "share-abc", startedAt: 1, exerciseId: "squat-barbell", kind: "normal" as const, weight: 185, unit: "lb" as const, reps: 5, completed: true }];
    const twice = [...exercises, ex(2, "squat-barbell")];
    const w = serializeLiftWorkout(workout(), twice, [...sets(), set(2)], { history })!;
    expect(detect).toHaveBeenCalledWith(history, "share-abc");
    expect(w.exercises[0].prs.map((p) => p.label)).toEqual([
      "e1rm 226 lb",
      "heaviest 205 lb × 3",
      "5 reps @ 185 lb",
      "volume 3,390 lb",
    ]);
    expect(w.exercises[2].prs).toEqual([]);
    expect(w.prs).toHaveLength(4);
  });

  it("weighted bodyweight sets: no e1rm, no volume pr, loads read with a plus", () => {
    const pull = [ex(0, "pull-up"), ex(1, "squat-barbell")];
    const pullSets = [
      set(0, { weight: 25, reps: 8, bodyweight: true }),
      set(0, { weight: 30, reps: 7, bodyweight: true }),
      set(1, { weight: 225, reps: 3 }),
    ];
    const hits: PrHit[] = [
      { exerciseId: "pull-up", kind: "e1rm", value: 20, previous: 15, set: { weight: 30, unit: "lb", reps: 7 } },
      { exerciseId: "pull-up", kind: "weight", value: 13.6, previous: 11.3, set: { weight: 30, unit: "lb", reps: 7 } },
      { exerciseId: "pull-up", kind: "reps_at_weight", value: 8, previous: 6, set: { weight: 25, unit: "lb", reps: 8 }, atWeightKg: 11.34 },
      { exerciseId: "pull-up", kind: "volume", value: 180, previous: 150, set: null },
      { exerciseId: "squat-barbell", kind: "e1rm", value: 112, previous: 100, set: { weight: 225, unit: "lb", reps: 3 } },
      { exerciseId: "squat-barbell", kind: "volume", value: 306, previous: 300, set: null },
    ];
    detect.mockReturnValue(hits);
    const history = [{ workoutId: "share-abc", startedAt: 1, exerciseId: "pull-up", kind: "normal" as const, weight: 30, unit: "lb" as const, reps: 7, completed: true }];
    const w = serializeLiftWorkout(workout(), pull, pullSets, { history })!;
    const [p, sq] = w.exercises;
    expect(p.topSet).toBe("+30 lb × 7");
    expect(p.bestE1rm).toBeNull();
    expect(p.working.map((g) => g.label)).toEqual(["1×8 @ +25 lb", "1×7 @ +30 lb"]);
    expect(p.prs.map((x) => x.label)).toEqual(["heaviest +30 lb × 7", "8 reps @ +25 lb"]);
    // a plain barbell lift in the same workout keeps all its records
    expect(sq.prs.map((x) => x.kind)).toEqual(["e1rm", "volume"]);
    expect(sq.bestE1rm).not.toBeNull();
  });

  it("unweighted and assisted bodyweight sets don't make an exercise relative", () => {
    const dips = [ex(0, "dip")];
    // an assisted set has a negative load and no records; a plain set has none at all
    const dipSets = [set(0, { weight: -40, reps: 8, bodyweight: true }), set(0, { weight: null, reps: 12, bodyweight: true })];
    detect.mockReturnValue([{ exerciseId: "dip", kind: "volume", value: 100, previous: 50, set: null }]);
    const history = [{ workoutId: "share-abc", startedAt: 1, exerciseId: "dip", kind: "normal" as const, weight: null, unit: null, reps: 12, completed: true }];
    const w = serializeLiftWorkout(workout(), dips, dipSets, { history })!;
    expect(w.exercises[0].prs.map((x) => x.kind)).toEqual(["volume"]);
    expect(w.exercises[0].bestE1rm).toBeNull();
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
    expect(isValidLiftId("share-caterxeu")).toBe(true);
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
      [w, w, workout({ id: "share-del", deletedAt: new Date() }), workout({ id: "share-dis", status: "discarded" })],
      [{ ...ex(0, "squat-barbell"), workoutId: "share-abc" }],
      [{ ...set(0), workoutId: "share-abc" }],
      [],
    );
    const out = await loadActivityLiftWorkouts({ id: 1, hidden: false });
    expect(out.map((x) => x.title)).toEqual(["Full Body B"]);
    expect(JSON.stringify(out)).not.toContain("share-abc");
    // the recording header already shows its own coarsened time
    expect(out[0].startTime).toBeNull();
  });

  it("degrades to nothing when the lift tables fail", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    queue.push(new Error("column does not exist"));
    expect(await loadActivityLiftWorkouts({ id: 1, hidden: false })).toEqual([]);
  });
});

describe("public ids", () => {
  const env = { ...process.env };
  beforeEach(() => {
    process.env = { ...env, LIFT_PUBLIC_ID_SECRET: "test-secret", AUTH_SECRET: "auth-secret" };
  });
  afterEach(() => {
    process.env = { ...env };
  });

  it("is a stable 16-char base64url hmac, keyed by the secret", () => {
    const a = publicLiftId("share-caterxeu")!;
    expect(a).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(isPublicLiftId(a)).toBe(true);
    expect(publicLiftId("share-caterxeu")).toBe(a);
    expect(publicLiftId("share-other")).not.toBe(a);
    expect(a).not.toContain("caterxeu");
    process.env.LIFT_PUBLIC_ID_SECRET = "rotated";
    expect(publicLiftId("share-caterxeu")).not.toBe(a);
  });

  it("falls back to AUTH_SECRET, and is off with neither", () => {
    delete process.env.LIFT_PUBLIC_ID_SECRET;
    expect(publicLiftId("share-x")).toMatch(/^[A-Za-z0-9_-]{16}$/);
    delete process.env.AUTH_SECRET;
    expect(publicLiftId("share-x")).toBeNull();
  });
});

const ROWS: LiftOnlyRow[] = [
  { id: "share-caterxeu", title: "Push", startedLocal: "2026-11-02T19:18", durationS: 3600, workingSets: 6, exerciseCount: 3 },
  { id: "share-0123456789abcdef", title: "Pull", startedLocal: "2026-11-01T07:00", durationS: null, workingSets: 1, exerciseCount: 1 },
  // a 16-char id that looks like a public one must still not resolve as itself
  { id: "abcdefghijklmnop", title: "Legs", startedLocal: "2026-10-30T07:00", durationS: null, workingSets: 4, exerciseCount: 2 },
];

describe("calendar entries", () => {
  const env = { ...process.env };
  beforeEach(() => {
    process.env = { ...env, LIFT_PUBLIC_ID_SECRET: "test-secret" };
  });
  afterEach(() => {
    process.env = { ...env };
  });

  it("maps a lift-only workout to a WeightTraining entry with its own page", () => {
    const e = publicLiftCalendarEntry(ROWS[0], 15)!;
    expect(e).toMatchObject({
      name: "Push",
      type: "WeightTraining",
      date: "2026-11-02",
      startTime: "19:15",
      duration: 3600,
      elapsedTime: 3600,
      averageHeartrate: null,
      description: null,
      href: `/lifts/${publicLiftId("share-caterxeu")}`,
      liftSummary: "3 exercises · 6 sets",
    });
    expect(e.id).toBeLessThan(0);
    // derived from the public id, so it says nothing the href doesn't
    expect(e.id).toBe(liftCalendarId(publicLiftId("share-caterxeu")!));
    expect(publicLiftCalendarEntry(ROWS[1], 0)!.duration).toBe(0);
    expect(publicLiftCalendarEntry(ROWS[1], 0)!.liftSummary).toBe("1 exercise · 1 set");
  });

  it("never puts an internal id or share slug in an entry", async () => {
    const entries = await loadLiftCalendar(async () => ROWS);
    expect(entries).toHaveLength(3);
    const json = JSON.stringify(entries);
    for (const r of ROWS) {
      expect(json).not.toContain(r.id);
      expect(json).not.toContain(r.id.replace(/^share-/, ""));
    }
  });

  it("is empty without a secret, rather than leaking ids", async () => {
    delete process.env.LIFT_PUBLIC_ID_SECRET;
    delete process.env.AUTH_SECRET;
    const index = vi.fn(async () => ROWS);
    expect(await loadLiftCalendar(index)).toEqual([]);
    expect(index).not.toHaveBeenCalled();
    expect(publicLiftCalendarEntry(ROWS[0], 0)).toBeNull();
    expect(await resolvePublicLiftId("abcdefghijklmnop", index)).toBeNull();
  });

  it("resolves public ids through the index only, never raw internal ids", async () => {
    const index = async () => ROWS;
    for (const r of ROWS) {
      expect((await resolvePublicLiftId(publicLiftId(r.id)!, index))?.id).toBe(r.id);
      expect(await resolvePublicLiftId(r.id, index)).toBeNull();
    }
    expect(await resolvePublicLiftId(publicLiftId("share-not-lift-only")!, index)).toBeNull();
    expect(await resolvePublicLiftId("a/b", index)).toBeNull();
  });

  it("synthetic ids are stable, negative and distinct", () => {
    expect(liftCalendarId("abc")).toBe(liftCalendarId("abc"));
    const ids = new Set(Array.from({ length: 500 }, (_, i) => liftCalendarId(publicLiftId(`share-${i}`)!)));
    expect(ids.size).toBe(500);
    for (const id of ids) expect(id).toBeLessThan(0);
  });
});
