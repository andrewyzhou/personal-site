import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Exercise, ParsedSet, ParsedWorkout } from "lift-core";

// parser, catalog lookup and muscle load are faked so these tests pin the
// planner's own mapping; the real lift-core runs in lift-plan-core.test.ts
const { parse, resolve, muscleLoad } = vi.hoisted(() => ({
  parse: vi.fn(),
  resolve: vi.fn(),
  muscleLoad: vi.fn(),
}));

vi.mock("lift-core", async (orig) => {
  const real = await orig<typeof import("lift-core")>();
  return {
    ...real,
    parseStrongText: (t: string) => parse(t),
    resolveExerciseName: (n: string) => resolve(n),
    computeMuscleLoad: (e: unknown) => muscleLoad(e),
    // simple stand-in so this file doesn't depend on the catalog's normalizer
    normalizeName: (n: string) =>
      n
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim(),
  };
});

import { pickEditTarget, planStrongIngest, type EditCandidate, type EditLookup } from "@/lib/lift/plan";
import { customExerciseId, guessEquipment, guessTracking, sha256Hex } from "@/lib/lift/rows";

const LB = 2.2046226218;

function set(partial: Partial<ParsedSet> & { position: number }): ParsedSet {
  return {
    kind: "normal",
    label: partial.position + 1,
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
    ...partial,
  };
}

const BENCH: Exercise = {
  id: "bench-press-barbell",
  name: "Bench Press (Barbell)",
  equipment: "barbell",
  category: "strength",
  tracking: "weight_reps",
  primary: ["chest"],
  secondary: ["triceps", "front_delts", "chest"],
  aliases: ["bench", "Bench Press"],
  freeDbId: "Barbell_Bench_Press",
  curated: true,
};

const PULLUP: Exercise = {
  id: "pull-up",
  name: "Pull Up",
  equipment: "bodyweight",
  category: "strength",
  tracking: "weighted_bodyweight",
  primary: ["lats"],
  secondary: ["biceps"],
  aliases: [],
  curated: true,
};

function pushDay(over: Partial<ParsedWorkout> = {}): ParsedWorkout {
  return {
    title: "Push Day",
    startedLocal: "2026-11-04T18:12",
    exercises: [
      {
        name: "Bench Press (Barbell)",
        notes: ["felt good"],
        sets: [
          set({ position: 0, kind: "warmup", label: 1, weight: 95, unit: "lb", reps: 10 }),
          set({ position: 1, weight: 185, unit: "lb", reps: 5 }),
          set({ position: 2, weight: 185, unit: "lb", reps: 5, rpe: 8 }),
        ],
      },
      {
        name: "Pull Up",
        notes: [],
        sets: [
          set({ position: 0, reps: 12, bodyweight: true }),
          set({ position: 1, weight: 25, unit: "lb", reps: 8, bodyweight: true }),
        ],
      },
    ],
    notes: [],
    link: "https://strong.app.link/AbCdEf123",
    linkSlug: "AbCdEf123",
    warnings: [],
    ...over,
  };
}

const RAW = "Push Day\n...raw share text...";

describe("planStrongIngest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    parse.mockReturnValue(pushDay());
    resolve.mockImplementation((n: string) => ({ "Bench Press (Barbell)": BENCH, "Pull Up": PULLUP })[n]);
    muscleLoad.mockReturnValue({ raw: { chest: 2, lats: 2 }, normalized: { chest: 1, lats: 1, triceps: 0.5 } });
  });

  it("derives deterministic ids from the sha and the link slug", () => {
    const plan = planStrongIngest(RAW, { source: "shortcut" });
    const sha = sha256Hex(RAW);
    expect(plan.sha256).toBe(sha);
    expect(plan.ingest).toMatchObject({
      id: `ing_${sha.slice(0, 24)}`,
      source: "shortcut",
      rawSha256: sha,
      rawText: RAW,
      strongSlug: "AbCdEf123",
      workoutId: "strong-AbCdEf123",
      status: "parsed",
    });
    expect(plan.workout!.workout.id).toBe("strong-AbCdEf123");
    expect(plan.workout!.workout.latestIngestId).toBe(plan.ingest.id);
    expect(planStrongIngest(RAW, { source: "shortcut" })).toEqual(plan);
  });

  it("ids a linkless workout by title + parsed start, so other channels collapse onto it", () => {
    const want = `strong-${sha256Hex("push day|2026-11-04T18:12").slice(0, 16)}`;
    parse.mockReturnValue(pushDay({ link: null, linkSlug: null }));
    expect(planStrongIngest(RAW, { source: "api" }).workout!.workout.id).toBe(want);
    // different raw bytes, same workout
    expect(planStrongIngest(RAW + "  \n", { source: "telegram" }).workout!.workout.id).toBe(want);
    parse.mockReturnValue(pushDay({ linkSlug: "../../etc'; drop" }));
    const plan = planStrongIngest(RAW, { source: "api" });
    expect(plan.workout!.workout.id).toBe(want);
    expect(plan.ingest.strongSlug).toBeNull();
    expect(plan.ingest.workoutId).toBe(want);
  });

  it("falls back to the raw sha without a link or a parsed date", () => {
    parse.mockReturnValue(pushDay({ link: null, linkSlug: null, startedLocal: null }));
    const plan = planStrongIngest(RAW, { source: "api", now: new Date("2026-11-05T02:12:00Z") });
    expect(plan.workout!.workout.id).toBe(`strong-${sha256Hex(RAW).slice(0, 16)}`);
  });

  it("refuses shares too big for one batch but keeps the raw ingest row", () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => set({ position: i, weight: 100, unit: "lb", reps: 5 }));
    const bench = (n: number) => ({ name: "Bench Press (Barbell)", notes: [], sets: many(n) });

    parse.mockReturnValue(pushDay({ exercises: [bench(250), bench(251)] }));
    const big = planStrongIngest(RAW, { source: "api" });
    expect(big.workout).toBeNull();
    expect(big.summary).toBeNull();
    expect(big.rejected).toMatch(/too big to log: 2 exercises \/ 501 sets/);
    expect(big.ingest).toMatchObject({ status: "empty", workoutId: null, rawText: RAW });
    expect(big.warnings.some((w) => w.message === big.rejected)).toBe(true);

    parse.mockReturnValue(pushDay({ exercises: Array.from({ length: 101 }, () => bench(1)) }));
    expect(planStrongIngest(RAW, { source: "api" }).rejected).toMatch(/101 exercises/);

    parse.mockReturnValue(pushDay({ exercises: [bench(250), bench(250)] }));
    const ok = planStrongIngest(RAW, { source: "api" });
    expect(ok.rejected).toBeNull();
    expect(ok.workout!.sets).toHaveLength(500);
  });

  it("keeps the raw text byte-for-byte", () => {
    const raw = "  Push Day \r\n\r\nBench Press  \n";
    expect(planStrongIngest(raw, { source: "api" }).ingest.rawText).toBe(raw);
  });

  it("builds catalog exercise, alias and muscle rows", () => {
    const w = planStrongIngest(RAW, { source: "shortcut" }).workout!;
    expect(w.exercises.map((e) => e.id)).toEqual(["bench-press-barbell", "pull-up"]);
    expect(w.exercises[0]).toMatchObject({
      name: "Bench Press (Barbell)",
      equipment: "barbell",
      source: "catalog",
      isCustom: false,
      freeDbId: "Barbell_Bench_Press",
    });
    const benchAliases = w.aliases.filter((a) => a.exerciseId === "bench-press-barbell");
    // canonical name and "Bench Press" both normalize away the parens differently; "bench" is its own
    expect(benchAliases.map((a) => a.normalized).sort()).toEqual(["bench", "bench press", "bench press barbell"]);
    const benchMuscles = w.muscles.filter((m) => m.exerciseId === "bench-press-barbell");
    // chest listed in both: primary wins, no duplicate pk
    expect(benchMuscles).toEqual([
      { exerciseId: "bench-press-barbell", region: "chest", role: "primary" },
      { exerciseId: "bench-press-barbell", region: "triceps", role: "secondary" },
      { exerciseId: "bench-press-barbell", region: "front_delts", role: "secondary" },
    ]);
  });

  it("turns unknown names into custom exercises with a stable id", () => {
    resolve.mockReturnValue(undefined);
    parse.mockReturnValue(
      pushDay({
        exercises: [
          { name: "Zercher Squat (Barbell)", notes: [], sets: [set({ position: 0, weight: 135, unit: "lb", reps: 5 })] },
        ],
      })
    );
    const w = planStrongIngest(RAW, { source: "telegram" }).workout!;
    const id = customExerciseId("Zercher Squat (Barbell)");
    expect(id).toMatch(/^custom-[0-9a-f]{12}$/);
    expect(customExerciseId("zercher squat barbell")).toBe(id);
    expect(w.exercises).toEqual([
      {
        id,
        name: "Zercher Squat (Barbell)",
        equipment: "barbell",
        category: "strength",
        tracking: "weight_reps",
        source: "strong",
        isCustom: true,
        freeDbId: null,
      },
    ]);
    expect(w.aliases).toEqual([{ exerciseId: id, alias: "Zercher Squat (Barbell)", normalized: "zercher squat barbell" }]);
    expect(w.muscles).toEqual([]);
    expect(w.workoutExercises[0].exerciseId).toBe(id);
    expect(muscleLoad).not.toHaveBeenCalled();
    expect(w.workout.muscleLoad).toEqual({});
  });

  it("lays out workout exercises and sets with positional ids", () => {
    const w = planStrongIngest(RAW, { source: "shortcut" }).workout!;
    expect(w.workoutExercises).toEqual([
      {
        id: "strong-AbCdEf123:0",
        workoutId: "strong-AbCdEf123",
        exerciseId: "bench-press-barbell",
        position: 0,
        nameRaw: "Bench Press (Barbell)",
        notes: "felt good",
        supersetGroup: null,
      },
      {
        id: "strong-AbCdEf123:1",
        workoutId: "strong-AbCdEf123",
        exerciseId: "pull-up",
        position: 1,
        nameRaw: "Pull Up",
        notes: null,
        supersetGroup: null,
      },
    ]);
    expect(w.sets.map((s) => s.id)).toEqual([
      "strong-AbCdEf123:0:0",
      "strong-AbCdEf123:0:1",
      "strong-AbCdEf123:0:2",
      "strong-AbCdEf123:1:0",
      "strong-AbCdEf123:1:1",
    ]);
    expect(w.sets.every((s) => s.workoutExerciseId === s.id!.split(":").slice(0, 2).join(":"))).toBe(true);
  });

  it("converts loads to kg and only estimates 1rm for absolute working sets", () => {
    const [warm, s1, s2, bw, weighted] = planStrongIngest(RAW, { source: "shortcut" }).workout!.sets;
    expect(warm).toMatchObject({ kind: "warmup", weight: 95, unit: "lb", reps: 10, e1rmKg: null });
    expect(warm.weightKg).toBeCloseTo(95 / LB, 2);
    expect(s1.weightKg).toBeCloseTo(185 / LB, 2);
    expect(s1.e1rmKg).toBeCloseTo((185 / LB) * (1 + 5 / 30), 1);
    expect(s2.rpe).toBe(8);
    expect(bw).toMatchObject({ weight: null, weightKg: null, reps: 12, bodyweight: true, e1rmKg: null });
    expect(weighted).toMatchObject({ weight: 25, bodyweight: true, e1rmKg: null });
    expect(weighted.weightKg).toBeCloseTo(25 / LB, 2);
  });

  it("converts distances to meters", () => {
    resolve.mockReturnValue(undefined);
    parse.mockReturnValue(
      pushDay({
        exercises: [
          {
            name: "Farmer's Walk",
            notes: [],
            sets: [
              set({ position: 0, weight: 70, unit: "kg", distance: 40, distanceUnit: "m" }),
              set({ position: 1, distance: 0.5, distanceUnit: "mi", durationS: 240 }),
            ],
          },
        ],
      })
    );
    const w = planStrongIngest(RAW, { source: "api" }).workout!;
    expect(w.sets[0]).toMatchObject({ distanceM: 40, weightKg: 70 });
    expect(w.sets[1]).toMatchObject({ distanceM: 804.67, durationS: 240 });
    expect(w.exercises[0].tracking).toBe("weight_distance");
  });

  it("totals working sets and volume, and loads muscles from catalog exercises", () => {
    const plan = planStrongIngest(RAW, { source: "shortcut" });
    const w = plan.workout!.workout;
    expect(w.workingSets).toBe(4);
    // tonnage is lift-core's call: bench 2 x 185 x 5 plus the pull-up's added 25 x 8
    expect(w.volumeKg).toBeCloseTo(2050 / LB, 1);
    expect(muscleLoad).toHaveBeenCalledWith([
      { exercise: BENCH, workingSets: 2 },
      { exercise: PULLUP, workingSets: 2 },
    ]);
    expect(w.muscleLoad).toEqual({ chest: 1, lats: 1, triceps: 0.5 });
    expect(plan.summary).toMatchObject({
      title: "Push Day",
      startedLocal: "2026-11-04T18:12",
      exerciseCount: 2,
      workingSets: 4,
      unit: "lb",
    });
    expect(plan.summary!.exercises[0]).toMatchObject({
      exerciseId: "bench-press-barbell",
      custom: false,
      workingSets: 2,
      topSet: { weight: 185, unit: "lb", reps: 5 },
    });
  });

  it("dedupes an exercise that appears twice", () => {
    const base = pushDay();
    parse.mockReturnValue({ ...base, exercises: [base.exercises[0], base.exercises[0]] });
    const w = planStrongIngest(RAW, { source: "shortcut" }).workout!;
    expect(w.exercises).toHaveLength(1);
    expect(w.workoutExercises.map((we) => we.id)).toEqual(["strong-AbCdEf123:0", "strong-AbCdEf123:1"]);
    expect(new Set(w.aliases.map((a) => a.normalized)).size).toBe(w.aliases.length);
  });

  it("derives startedAt from the configured zone", () => {
    const w = planStrongIngest(RAW, { source: "shortcut", timezone: "America/Los_Angeles" }).workout!.workout;
    // nov 4 is after the dst change: pst, utc-8
    expect(w.startedAt!.toISOString()).toBe("2026-11-05T02:12:00.000Z");
    expect(w.utcOffsetMin).toBe(-480);
    expect(w.endedAt).toBeNull();
    expect(w.durationS).toBeNull();
    expect(w.source).toBe("strong-text");
  });

  it("uses the receive time when the share has no date", () => {
    parse.mockReturnValue(pushDay({ startedLocal: null }));
    const plan = planStrongIngest(RAW, {
      source: "shortcut",
      timezone: "America/New_York",
      now: new Date("2026-07-01T16:30:00Z"),
    });
    expect(plan.workout!.workout.startedLocal).toBe("2026-07-01T12:30");
    expect(plan.warnings.some((w) => /no workout date/.test(w.message))).toBe(true);
    expect(plan.ingest.warnings).toEqual(plan.warnings);
  });

  it("passes parser warnings through", () => {
    parse.mockReturnValue(pushDay({ warnings: [{ line: 7, message: "unrecognized set line", text: "Set 3: ???" }] }));
    expect(planStrongIngest(RAW, { source: "shortcut" }).warnings).toEqual([
      { line: 7, message: "unrecognized set line", text: "Set 3: ???" },
    ]);
  });

  it("plans an empty ingest when nothing parsed", () => {
    parse.mockReturnValue(pushDay({ exercises: [] }));
    const plan = planStrongIngest("hello there", { source: "telegram" });
    expect(plan.workout).toBeNull();
    expect(plan.summary).toBeNull();
    expect(plan.ingest).toMatchObject({ status: "empty", workoutId: null, rawText: "hello there" });
  });
});

describe("planStrongIngest edit options", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    parse.mockReturnValue(pushDay());
    resolve.mockImplementation((n: string) => ({ "Bench Press (Barbell)": BENCH, "Pull Up": PULLUP })[n]);
    muscleLoad.mockReturnValue({ raw: {}, normalized: {} });
  });

  it("lands on a given workout id but keeps the share's own slug and ingest id", () => {
    const plan = planStrongIngest(RAW, { source: "telegram", workoutId: "strong-OldSlug" });
    expect(plan.ingest).toMatchObject({ id: `ing_${sha256Hex(RAW).slice(0, 24)}`, workoutId: "strong-OldSlug", strongSlug: "AbCdEf123" });
    expect(plan.workout!.workout).toMatchObject({ id: "strong-OldSlug", strongSlug: "AbCdEf123" });
    expect(plan.workout!.workoutExercises.map((we) => we.id)).toEqual(["strong-OldSlug:0", "strong-OldSlug:1"]);
    expect(plan.workout!.sets[0].id).toBe("strong-OldSlug:0:0");
  });

  it("stores extra warnings on the ingest row", () => {
    const extra = { line: 0, message: "2 workouts already start at that minute", text: "a, b" };
    const plan = planStrongIngest(RAW, { source: "api", extraWarnings: [extra] });
    expect(plan.warnings).toContainEqual(extra);
    expect(plan.ingest.warnings).toContainEqual(extra);
  });

  it("lists working sets per exercise for the summary, warm-ups left out", () => {
    const [bench, pull] = planStrongIngest(RAW, { source: "api" }).summary!.exercises;
    expect(bench.sets).toEqual([
      { weight: 185, unit: "lb", reps: 5, durationS: null, distance: null, distanceUnit: null, bodyweight: false },
      { weight: 185, unit: "lb", reps: 5, durationS: null, distance: null, distanceUnit: null, bodyweight: false },
    ]);
    expect(pull.sets.map((s) => [s.weight, s.reps, s.bodyweight])).toEqual([
      [null, 12, true],
      [25, 8, true],
    ]);
  });
});

describe("pickEditTarget", () => {
  const SHARE: EditLookup = {
    plannedId: "strong-NewSlug",
    slug: "NewSlug",
    title: "Full Body B",
    startedLocal: "2026-11-02T19:18",
    exerciseNames: ["Squat (Barbell)", "Deadlift (Barbell)", "Bicep Curl (Dumbbell)"],
  };
  function cand(over: Partial<EditCandidate>): EditCandidate {
    return {
      id: "strong-caterxeu",
      title: "Full Body B",
      startedLocal: "2026-11-02T19:18",
      strongSlug: "caterxeu",
      source: "strong-text",
      deletedAt: null,
      exerciseNames: ["Squat (Barbell)", "Deadlift (Barbell)", "Bicep Curl (Dumbbell)"],
      ...over,
    };
  }

  it("is new with nothing stored", () => {
    expect(pickEditTarget(SHARE, [])).toEqual({ kind: "new" });
  });

  it("rewrites its own id when it exists (a same-link edit), noting a deleted one", () => {
    expect(pickEditTarget(SHARE, [cand({ id: "strong-NewSlug", strongSlug: "NewSlug" }), cand({})])).toEqual({
      kind: "existing",
      workoutId: "strong-NewSlug",
      deleted: false,
    });
    expect(pickEditTarget(SHARE, [cand({ id: "strong-NewSlug", deletedAt: new Date() })])).toMatchObject({ deleted: true });
  });

  it("follows its link to whichever workout already holds it", () => {
    expect(pickEditTarget({ ...SHARE, startedLocal: "2026-11-02T20:00" }, [cand({ strongSlug: "NewSlug" })])).toEqual({
      kind: "existing",
      workoutId: "strong-caterxeu",
      deleted: false,
    });
  });

  it("treats a new link at the same minute with the same title as an edit, even with new exercises", () => {
    const share = { ...SHARE, exerciseNames: ["Leg Press", "Row (Cable)"] };
    expect(pickEditTarget(share, [cand({})])).toMatchObject({ kind: "existing", workoutId: "strong-caterxeu" });
  });

  it("treats a renamed workout as an edit when most exercises carry over", () => {
    const renamed = { ...SHARE, title: "Legs + Arms", exerciseNames: ["Squat (Barbell)", "Deadlift (Barbell)", "Leg Curl"] };
    // 2 of 3 names
    expect(pickEditTarget(renamed, [cand({})])).toMatchObject({ kind: "existing", workoutId: "strong-caterxeu" });
    const mostlyNew = { ...renamed, exerciseNames: ["Squat (Barbell)", "Leg Curl", "Calf Raise", "Leg Press"] };
    // 1 of 4
    expect(pickEditTarget(mostlyNew, [cand({})])).toEqual({ kind: "new" });
    // exactly half counts
    expect(pickEditTarget({ ...renamed, exerciseNames: ["squat barbell", "Leg Curl"] }, [cand({ exerciseNames: ["Squat (Barbell)", "Row"] })])).toMatchObject({
      kind: "existing",
    });
  });

  it("ignores other minutes, deleted workouts, app workouts and dateless shares", () => {
    expect(pickEditTarget(SHARE, [cand({ startedLocal: "2026-11-02T19:19" })])).toEqual({ kind: "new" });
    expect(pickEditTarget(SHARE, [cand({ deletedAt: new Date() })])).toEqual({ kind: "new" });
    expect(pickEditTarget(SHARE, [cand({ source: "app" })])).toEqual({ kind: "new" });
    expect(pickEditTarget({ ...SHARE, startedLocal: null }, [cand({})])).toEqual({ kind: "new" });
    expect(pickEditTarget(SHARE, [cand({ source: "strong-csv", id: "strong-csv1" })])).toMatchObject({ workoutId: "strong-csv1" });
  });

  it("doesn't guess between several matches", () => {
    expect(pickEditTarget(SHARE, [cand({ id: "strong-b" }), cand({ id: "strong-a", strongSlug: "a" })])).toEqual({
      kind: "ambiguous",
      workoutIds: ["strong-a", "strong-b"],
    });
    // a different workout at the same minute doesn't count against the match
    expect(
      pickEditTarget(SHARE, [cand({}), cand({ id: "strong-core", title: "Core", strongSlug: "c", exerciseNames: ["Plank"] })])
    ).toMatchObject({ kind: "existing", workoutId: "strong-caterxeu" });
  });
});

describe("custom exercise guesses", () => {
  it("reads equipment from strong's parenthetical", () => {
    expect(guessEquipment("Curl (Cable)")).toBe("cable");
    expect(guessEquipment("Squat (Smith Machine)")).toBe("smith");
    expect(guessEquipment("Thing")).toBe("other");
    expect(guessEquipment("Thing (Weird)")).toBe("other");
  });

  it("infers tracking from the logged sets", () => {
    expect(guessTracking([set({ position: 0, reps: 10, bodyweight: true })])).toBe("reps");
    expect(guessTracking([set({ position: 0, weight: 20, unit: "lb", reps: 5, bodyweight: true })])).toBe(
      "weighted_bodyweight"
    );
    expect(guessTracking([set({ position: 0, weight: -40, unit: "lb", reps: 5, bodyweight: true })])).toBe(
      "assisted_bodyweight"
    );
    expect(guessTracking([set({ position: 0, durationS: 60 })])).toBe("duration");
    expect(guessTracking([set({ position: 0, distance: 1, distanceUnit: "km", durationS: 300 })])).toBe(
      "distance_duration"
    );
  });
});
