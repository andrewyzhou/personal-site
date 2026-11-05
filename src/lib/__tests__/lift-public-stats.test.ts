import { describe, it, expect, afterEach, vi } from "vitest";
import {
  MUSCLE_GROUPS,
  addDays,
  buildLiftsOverview,
  groupWeights,
  liftDateLabel,
  publicWorkoutHrefs,
  weekContextLine,
  weekStartOf,
  weeklyMuscleVolume,
  type OverviewInput,
  type StatsSetRow,
} from "@/lib/lift/public-stats";
import { buildFixtureInput } from "@/lib/lift/public-fixture";
import { liftFixtureOn } from "@/lib/lift/public";
import { MUSCLE_REGIONS } from "lift-core";

const TODAY = "2026-11-04"; // a wednesday
const pid = (id: string) => `pub_${id.replace(/[^a-z0-9]/gi, "").slice(0, 12).padEnd(12, "x")}`;

// a small world: rows are built like the db returns them
function world() {
  const input: OverviewInput = { workouts: [], links: [], exercises: [], sets: [] };
  const add = (
    id: string,
    startedLocal: string,
    exs: { exerciseId: string; sets: Partial<StatsSetRow>[] }[],
    over: Partial<OverviewInput["workouts"][number]> = {},
  ) => {
    input.workouts.push({ id, title: `session ${input.workouts.length + 1}`, startedLocal, durationS: null, status: "finished", deletedAt: null, muscleLoad: {}, ...over });
    exs.forEach((e, i) => {
      const weId = `${id}:${i}`;
      input.exercises.push({ id: weId, workoutId: id, exerciseId: e.exerciseId, position: i, nameRaw: e.exerciseId, customName: null });
      e.sets.forEach((s, j) =>
        input.sets.push({
          workoutExerciseId: weId,
          position: j,
          kind: "normal",
          weight: 185,
          unit: "lb",
          reps: 5,
          durationS: null,
          distanceM: null,
          bodyweight: false,
          completed: true,
          ...s,
        }),
      );
    });
  };
  return { input, add };
}

const bench = (weights: number[], extra: Partial<StatsSetRow> = {}) => ({
  exerciseId: "bench-press-barbell",
  sets: weights.map((weight) => ({ weight, ...extra })),
});

describe("muscle groups", () => {
  it("covers every figure region exactly once", () => {
    const all = MUSCLE_GROUPS.flatMap((g) => g.regions);
    expect([...all].sort()).toEqual([...MUSCLE_REGIONS].sort());
  });

  it("credits a group 1 for primary, 0.5 for secondary, once per set", () => {
    // bench: chest primary; front delts + triceps secondary
    expect(groupWeights(["chest"], ["front_delts", "triceps"])).toEqual({ chest: 1, shoulders: 0.5, arms: 0.5 });
    // two shoulder regions are still one shoulder set
    expect(groupWeights(["front_delts"], ["side_delts", "triceps"])).toEqual({ shoulders: 1, arms: 0.5 });
    // primary wins over secondary in the same group
    expect(groupWeights(["quads"], ["hamstrings"])).toEqual({ legs: 1 });
  });
});

describe("dates", () => {
  it("weeks start on monday", () => {
    expect(weekStartOf("2026-11-02")).toBe("2026-11-02");
    expect(weekStartOf("2026-11-04")).toBe("2026-11-02");
    expect(weekStartOf("2026-11-08")).toBe("2026-11-02");
    expect(weekStartOf("2026-11-09")).toBe("2026-11-09");
    expect(weekStartOf("2026-01-01")).toBe("2025-12-29");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
  });

  it("labels dates, with a year only when it differs", () => {
    expect(liftDateLabel("2026-11-03", TODAY)).toBe("tue, nov 3");
    expect(liftDateLabel("2025-12-31", TODAY)).toBe("wed, dec 31, 2025");
  });
});

describe("weeklyMuscleVolume", () => {
  it("returns the last 12 weeks oldest first, ignoring older entries", () => {
    const weeks = weeklyMuscleVolume(
      [
        { date: "2026-11-03", exercises: [{ exerciseId: "bench-press-barbell", workingSets: 4, tonnageKg: 1000 }] },
        { date: "2026-08-01", exercises: [{ exerciseId: "bench-press-barbell", workingSets: 9, tonnageKg: 1 }] },
      ],
      TODAY,
    );
    expect(weeks).toHaveLength(12);
    expect(weeks[11].start).toBe("2026-11-02");
    expect(weeks[0].start).toBe("2026-08-17");
    expect(weeks[11].sets.chest).toBe(4);
    expect(weeks[11].sets.arms).toBe(2);
    expect(weeks[11].sets.shoulders).toBe(2);
    // tonnage only to primary groups
    expect(weeks[11].tonnageKg.chest).toBe(1000);
    expect(weeks[11].tonnageKg.arms).toBe(0);
    expect(weeks.reduce((s, w) => s + w.workingSets, 0)).toBe(4);
  });

  it("counts unknown exercises as sets but not muscles", () => {
    const [w] = weeklyMuscleVolume([{ date: TODAY, exercises: [{ exerciseId: "custom-zzz", workingSets: 3, tonnageKg: 0 }] }], TODAY, 1);
    expect(w.workingSets).toBe(3);
    expect(Object.values(w.sets).every((v) => v === 0)).toBe(true);
  });
});

describe("publicWorkoutHrefs", () => {
  const w = (id: string, over: Partial<OverviewInput["workouts"][number]> = {}) => ({
    id,
    startedLocal: "2026-11-01T10:00",
    status: "finished",
    deletedAt: null as Date | null,
    ...over,
  });

  it("links lift-only to /lifts, linked to the public recording, and drops the rest", () => {
    const hrefs = publicWorkoutHrefs(
      [w("solo"), w("rec"), w("hiddenrec"), w("mixed"), w("gone", { status: "discarded" }), w("del", { deletedAt: new Date() }), w("live", { status: "active" })],
      [
        { workoutId: "rec", activityId: 7, role: "primary", activityHidden: false },
        { workoutId: "hiddenrec", activityId: 8, role: "primary", activityHidden: true },
        { workoutId: "mixed", activityId: 9, role: "primary", activityHidden: true },
        { workoutId: "mixed", activityId: 11, role: "duplicate", activityHidden: false },
      ],
      pid,
    );
    expect(Object.fromEntries(hrefs)).toEqual({
      solo: `/lifts/${pid("solo")}`,
      rec: "/activities/7",
      mixed: "/activities/11",
    });
  });

  it("gives lift-only workouts nothing without a public id", () => {
    expect(publicWorkoutHrefs([w("solo")], [], () => null).size).toBe(0);
  });
});

describe("buildLiftsOverview", () => {
  it("aggregates only publishable workouts and never leaks ids", () => {
    const { input, add } = world();
    add("solo-1", "2026-11-02T18:00", [bench([185, 185, 185]), { exerciseId: "bench-press-barbell", sets: [{ kind: "warmup", weight: 95 }] }]);
    add("rec-1", "2026-11-03T07:00", [bench([190, 190])]);
    add("private-1", "2026-11-03T08:00", [bench([500, 500, 500, 500])]);
    add("discarded-1", "2026-11-03T09:00", [bench([500])], { status: "discarded" });
    add("deleted-1", "2026-11-03T09:30", [bench([500])], { deletedAt: new Date() });
    input.links.push({ workoutId: "rec-1", activityId: 42, role: "primary", activityHidden: false });
    input.links.push({ workoutId: "private-1", activityId: 43, role: "primary", activityHidden: true });

    const o = buildLiftsOverview(input, { today: TODAY, publicIdOf: pid });
    const now = o.weeks[o.weeks.length - 1];
    // 3 + 2 working sets; the warm-up and the private/discarded/deleted ones don't count
    expect(now.workingSets).toBe(5);
    expect(now.workouts).toBe(2);
    expect(now.sets.chest).toBe(5);
    expect(o.weekTotals["2026-11-02"]).toEqual({ workouts: 2, workingSets: 5 });
    expect(o.recent.map((r) => r.href)).toEqual(["/activities/42", `/lifts/${pid("solo-1")}`]);
    expect(o.recent[0].linked).toBe(true);

    const json = JSON.stringify(o);
    for (const leak of ["solo-1", "rec-1", "private-1", "discarded-1", "deleted-1", "T18:00", "T07:00", "500"]) {
      expect(json).not.toContain(leak);
    }
  });

  it("finds prs in public workouts against the whole history, newest first", () => {
    const { input, add } = world();
    add("a", "2026-10-01T10:00", [bench([185])]);
    add("b", "2026-10-08T10:00", [bench([195])]); // weight pr over a
    add("hidden", "2026-10-15T10:00", [bench([225])]); // private, but it raises the bar
    add("c", "2026-10-22T10:00", [bench([215])]); // under the private 225: no weight pr
    add("d", "2026-10-29T10:00", [bench([230])]); // pr again
    input.links.push({ workoutId: "hidden", activityId: 1, role: "primary", activityHidden: true });

    const o = buildLiftsOverview(input, { today: TODAY, publicIdOf: pid });
    const hasWeight = (p: (typeof o.prs)[number]) => p.records.some((r) => r.kind === "weight");
    const weightPrs = o.prs.filter(hasWeight);
    expect(weightPrs.map((p) => p.date)).toEqual(["2026-10-29", "2026-10-08"]);
    expect(weightPrs[0].href).toBe(`/lifts/${pid("d")}`);
    expect(weightPrs[0].records.find((r) => r.kind === "weight")?.label).toContain("230");
    // one row per exercise, records in e1rm-first order
    expect(weightPrs[0].records.map((r) => r.kind)).toEqual(["e1rm", "weight", "volume"]);
    expect(o.prs.some((p) => p.date === "2026-10-15")).toBe(false);
    expect(o.prs.some((p) => p.date === "2026-10-22" && hasWeight(p))).toBe(false);
  });

  it("weighted pull-up prs keep the added load and drop e1rm and volume", () => {
    const { input, add } = world();
    const pull = (weight: number, reps: number) => ({ exerciseId: "pull-up", sets: [{ weight, reps, bodyweight: true }] });
    add("a", "2026-10-01T10:00", [pull(25, 6)]);
    add("b", "2026-10-08T10:00", [pull(30, 7)]);
    const o = buildLiftsOverview(input, { today: TODAY, publicIdOf: pid });
    const row = o.prs.find((p) => p.date === "2026-10-08");
    expect(row?.records).toEqual([{ kind: "weight", label: "heaviest +30 lb × 7" }]);
    expect(JSON.stringify(o.prs)).not.toContain("e1rm");
  });

  it("caps the pr feed and the recent list", () => {
    const { input, add } = world();
    for (let i = 0; i < 40; i++) add(`w${i}`, `${addDays("2026-06-01", i)}T10:00`, [bench([100 + i * 5])]);
    const o = buildLiftsOverview(input, { today: TODAY, publicIdOf: pid, prLimit: 20, recentLimit: 10 });
    expect(o.prs).toHaveLength(20);
    expect(o.recent).toHaveLength(10);
    expect(o.prs[0].date > o.prs[19].date).toBe(true);
  });

  it("hides the neck row unless something trained it", () => {
    const { input, add } = world();
    add("x", "2026-11-02T10:00", [bench([100])]);
    const o = buildLiftsOverview(input, { today: TODAY, publicIdOf: pid });
    expect(o.groups.map((g) => g.key)).toEqual(["chest", "shoulders", "arms", "back", "core", "glutes", "legs"]);
  });

  it("is empty, not broken, with no data", () => {
    const o = buildLiftsOverview({ workouts: [], links: [], exercises: [], sets: [] }, { today: TODAY, publicIdOf: pid });
    expect(o.weeks).toHaveLength(12);
    expect(o.window.workouts).toBe(0);
    expect(o.prs).toEqual([]);
    expect(o.recent).toEqual([]);
  });
});

describe("weekContextLine", () => {
  it("names this week or the week of, and counts", () => {
    const totals = { "2026-11-02": { workouts: 3, workingSets: 41 }, "2026-10-26": { workouts: 1, workingSets: 1 } };
    expect(weekContextLine({ weekTotals: totals, today: TODAY }, "2026-11-03")).toBe("this week: 3 workouts · 41 working sets");
    expect(weekContextLine({ weekTotals: totals, today: TODAY }, "2026-10-30")).toBe("week of oct 26: 1 workout · 1 working set");
    expect(weekContextLine({ weekTotals: totals, today: TODAY }, "2026-01-01")).toBeNull();
  });
});

describe("dev fixture", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is off in production even with the flag", () => {
    vi.stubEnv("LIFT_PUBLIC_FIXTURE", "1");
    vi.stubEnv("NODE_ENV", "production");
    expect(liftFixtureOn()).toBe(false);
    vi.stubEnv("NODE_ENV", "development");
    expect(liftFixtureOn()).toBe(true);
  });

  it("fills every week and keeps its never-shown rows out", () => {
    const input = buildFixtureInput(TODAY, [{ id: 5, date: "2026-10-20" }]);
    // every fixture exercise is a real catalog entry
    const o = buildLiftsOverview(input, { today: TODAY, publicIdOf: pid });
    expect(o.weeks.every((w) => w.workouts > 0)).toBe(true);
    expect(o.prs.length).toBeGreaterThan(5);
    expect(o.recent.some((r) => r.href === "/activities/5")).toBe(true);
    expect(JSON.stringify(o)).not.toContain("SHOULD NOT SHOW");
    expect(o.groups.length).toBeGreaterThanOrEqual(7);
  });
});
