import { describe, it, expect, beforeEach, vi } from "vitest";

// the db module is never touched: every test passes an in-memory store
vi.mock("@/lib/db", () => ({}));

import { answerLiftQuestion, localToday } from "@/lib/lift/query";
import type { QueryStore } from "@/lib/lift/query/db";
import {
  HELP_TEXT,
  displayUnit,
  sessionsOf,
  workoutHits,
  workoutPublicUrl,
  type QuerySet,
  type QueryWorkout,
} from "@/lib/lift/query/answer";
import { publicLiftId } from "@/lib/lift/public-id";

// wed nov 4 2026, 12:00 in los angeles
const NOW = new Date("2026-11-04T20:00:00Z");

type FixtureSet = QuerySet & { exerciseId: string };

function workout(p: Partial<QueryWorkout> & Pick<QueryWorkout, "id" | "title" | "startedLocal">): QueryWorkout {
  return {
    status: "finished",
    workingSets: 0,
    volumeKg: 0,
    muscleLoad: {},
    exerciseNames: [],
    unit: "lb",
    linkCount: 0,
    publicActivityId: null,
    ...p,
  };
}

let seq = 0;
function sets(workoutId: string, exerciseId: string, exercisePosition: number, list: Partial<QuerySet>[]): FixtureSet[] {
  return list.map((s, position) => ({
    workoutId,
    exerciseId,
    exercisePosition,
    position,
    kind: "normal",
    weight: null,
    unit: "lb",
    reps: null,
    durationS: null,
    distanceM: null,
    bodyweight: false,
    completed: true,
    ...s,
  })).map((s) => ({ ...s, position: s.position ?? seq++ }));
}

const x = (weight: number, reps: number, extra: Partial<QuerySet> = {}): Partial<QuerySet> => ({ weight, reps, ...extra });

const WORKOUTS: QueryWorkout[] = [
  workout({
    id: "w-push-1",
    title: "Push Day",
    startedLocal: "2026-10-27T18:00",
    workingSets: 6,
    volumeKg: 2700,
    muscleLoad: { chest: 1, front_delts: 0.9, triceps: 0.6 },
    exerciseNames: ["Bench Press (Barbell)", "Overhead Press (Barbell)"],
    linkCount: 1,
    publicActivityId: 111,
  }),
  workout({
    id: "w-legs-1",
    title: "Legs",
    startedLocal: "2026-10-29T18:00",
    workingSets: 4,
    volumeKg: 2300,
    muscleLoad: { quads: 1, glutes: 0.9, hamstrings: 0.7 },
    exerciseNames: ["Squat (Barbell)", "Deadlift (Barbell)"],
  }),
  workout({
    id: "w-push-2",
    title: "Push Day",
    startedLocal: "2026-11-02T18:00",
    workingSets: 4,
    volumeKg: 1900,
    muscleLoad: { chest: 1, front_delts: 0.8, triceps: 0.5 },
    exerciseNames: ["Bench Press (Barbell)", "Overhead Press (Barbell)"],
    // linked, but the recording is private: no link at all
    linkCount: 1,
    publicActivityId: null,
  }),
  workout({
    id: "w-full-1",
    title: "Full Body B",
    startedLocal: "2026-11-03T07:00",
    workingSets: 2,
    volumeKg: 1400,
    muscleLoad: { quads: 0.75, glutes: 1, back: 0.2, lower_back: 0.75 },
    exerciseNames: ["Squat (Barbell)"],
  }),
  workout({
    id: "w-pull-active",
    title: "Pull",
    startedLocal: "2026-11-04T09:30",
    status: "active",
    workingSets: 3,
    volumeKg: 0,
    muscleLoad: { lats: 1, biceps: 0.6, upper_back: 0.8 },
    exerciseNames: ["Pull Up"],
  }),
];

const SETS: FixtureSet[] = [
  ...sets("w-push-1", "bench-press-barbell", 0, [x(135, 5, { kind: "warmup" }), x(185, 5), x(185, 5), x(185, 5)]),
  ...sets("w-push-1", "overhead-press-barbell", 1, [x(115, 5), x(115, 5), x(115, 5)]),
  ...sets("w-legs-1", "squat-barbell", 0, [x(275, 5), x(275, 5), x(275, 5)]),
  ...sets("w-legs-1", "deadlift-barbell", 1, [x(315, 3)]),
  ...sets("w-push-2", "bench-press-barbell", 0, [x(190, 5), x(190, 5), x(185, 6), x(205, 1, { completed: false })]),
  ...sets("w-push-2", "overhead-press-barbell", 1, [x(120, 5)]),
  ...sets("w-full-1", "squat-barbell", 0, [x(285, 3), x(225, 8)]),
  ...sets("w-pull-active", "pull-up", 0, [{ reps: 10, weight: null, bodyweight: true }, { reps: 8, bodyweight: true }, x(25, 5, { bodyweight: true })]),
];

function store(workouts = WORKOUTS, allSets = SETS): QueryStore & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async workouts(window, limit) {
      calls.push("workouts");
      return workouts
        .filter((w) => !window || (w.startedLocal.slice(0, 10) >= window.start && w.startedLocal.slice(0, 10) < window.end))
        .sort((a, b) => (a.startedLocal < b.startedLocal ? 1 : -1))
        .slice(0, limit);
    },
    async exerciseSets(exerciseId) {
      calls.push(`sets:${exerciseId}`);
      const s = allSets.filter((r) => r.exerciseId === exerciseId);
      const ids = new Set(s.map((r) => r.workoutId));
      return { workouts: workouts.filter((w) => ids.has(w.id)), sets: s };
    },
    async knownExercises() {
      calls.push("known");
      return [{ id: "custom-zottman", name: "Zottman Curl Thing", uses: 3 }];
    },
  };
}

const LEGS_URL = () => `https://www.andrewzhou.org/lifts/${publicLiftId("w-legs-1")}`;
const FULL_URL = () => `https://www.andrewzhou.org/lifts/${publicLiftId("w-full-1")}`;

async function ask(text: string, s = store()) {
  return answerLiftQuestion(text, { now: NOW, store: s });
}

describe("lift bot answers", () => {
  beforeEach(() => {
    process.env.LIFT_PUBLIC_ID_SECRET = "test-secret";
    process.env.LIFT_TIMEZONE = "America/Los_Angeles";
  });

  it("knows today in the lift timezone", () => {
    expect(localToday(NOW)).toBe("2026-11-04");
    // 7pm on the 4th in la is already the 5th in utc
    expect(localToday(new Date("2026-11-05T03:00:00Z"))).toBe("2026-11-04");
  });

  it("what did i bench last week", async () => {
    expect(await ask("what did i bench last week")).toBe(
      [
        "bench press (barbell) last week:",
        "tue oct 27 · 3×5 @ 185 lb · e1rm 216 lb",
        "https://www.andrewzhou.org/activities/111",
      ].join("\n"),
    );
  });

  it("this week's bench has no link: its recording is private", async () => {
    expect(await ask("bench this week")).toBe(["bench press (barbell) this week:", "mon nov 2 · 190×5 ×2, 185×6 lb · e1rm 222 lb"].join("\n"));
  });

  it("an empty window says when it was last done", async () => {
    expect(await ask("bench yesterday")).toBe("no bench press (barbell) yesterday (last time: mon nov 2 (2 days ago))");
  });

  it("squat pr", async () => {
    expect(await ask("squat pr")).toBe(
      ["squat (barbell) prs:", "heaviest 285 lb × 3 · tue nov 3", "best e1rm 321 lb (275×5) · thu oct 29", FULL_URL(), LEGS_URL()].join("\n"),
    );
  });

  it("best deadlift", async () => {
    expect(await ask("best deadlift")).toBe(
      ["deadlift (barbell) prs:", "heaviest 315 lb × 3 · thu oct 29", "best e1rm 347 lb (315×3) · thu oct 29", LEGS_URL()].join("\n"),
    );
  });

  it("e1rm bench", async () => {
    expect(await ask("e1rm bench")).toBe(
      ["bench press (barbell) e1rm: 222 lb (185×6 · mon nov 2)"].join("\n"),
    );
  });

  it("how many workouts this month", async () => {
    expect(await ask("how many workouts this month")).toBe("3 workouts this month · 9 sets · 7,275 lb");
  });

  it("last leg day", async () => {
    expect(await ask("last leg day")).toBe(
      ["last leg day: tue nov 3 (yesterday) · full body b · squat (barbell) · 2 sets · 3,086 lb", FULL_URL()].join("\n"),
    );
  });

  it("volume this week", async () => {
    expect(await ask("volume this week")).toBe("volume this week: 7,275 lb · 3 workouts · 9 sets");
  });

  it("ohp history", async () => {
    expect(await ask("ohp history")).toBe(
      [
        "overhead press (barbell) history (2 sessions):",
        "mon nov 2 · 1×5 @ 120 lb · e1rm 140 lb",
        "tue oct 27 · 3×5 @ 115 lb · e1rm 134 lb",
        "e1rm 134 lb → 140 lb since tue oct 27",
      ].join("\n"),
    );
  });

  it("when did i last train back", async () => {
    // the active pull session has no public page yet
    expect(await ask("when did i last train back")).toBe("last back day: wed nov 4 (today) · pull · pull up · 3 sets");
  });

  it("help and unknown", async () => {
    const s = store();
    expect(await ask("/help", s)).toBe(HELP_TEXT);
    expect(HELP_TEXT).toMatch(/^share a workout from strong to this chat to log it, or ask:/);
    expect(await ask("thanks", s)).toMatch(/^not sure what you're asking\. try:/);
    expect(await ask("best leg day", s)).toMatch(/^not sure what you're asking/);
    expect(s.calls).toEqual([]);
  });

  it("an unknown exercise in a real question says so", async () => {
    expect(await ask("qwzx pr")).toBe(`don't know an exercise called "qwzx". try a name like "bench", "squat" or "lat pulldown", or /help`);
  });

  it("catalog names cost one select; the owner's list is only read otherwise", async () => {
    const s = store();
    await ask("squat pr", s);
    expect(s.calls).toEqual(["sets:squat-barbell"]);
    const s2 = store();
    expect(await ask("zottman curl thing pr", s2)).toBe("no zottman curl thing logged yet");
    expect(s2.calls).toEqual(["known", "sets:custom-zottman"]);
  });

  it("bodyweight moves report reps", async () => {
    expect(await ask("pull up pr")).toBe(
      ["pull up prs:", "heaviest +25 lb × 5 · wed nov 4"].join("\n"),
    );
    expect(await ask("last pull up")).toBe("last pull up: wed nov 4 (today) · 10, 8, +25×5 lb");
  });

  it("counts, days and windows", async () => {
    expect(await ask("how many leg days this month")).toBe("1 leg day this month · 2 sets · 3,086 lb");
    expect(await ask("how many times did i squat since oct 1")).toBe("squat (barbell): 2 sessions · 5 sets since oct 1");
    expect(await ask("what did i do last week")).toBe(
      [
        "2 workouts last week:",
        "thu oct 29 · legs · squat (barbell), deadlift (barbell) · 4 sets · 5,071 lb",
        "tue oct 27 · push day · bench press (barbell), overhead press (barbell) · 6 sets · 5,952 lb",
      ].join("\n"),
    );
    expect(await ask("what did i do on friday")).toBe("no workouts fri oct 30");
    expect(await ask("what did i do on oct 29")).toBe(
      ["1 workout on oct 29:", "thu oct 29 · legs · squat (barbell), deadlift (barbell) · 4 sets · 5,071 lb", LEGS_URL()].join("\n"),
    );
    expect(await ask("bench volume last week")).toBe("bench press (barbell) volume last week: 2,775 lb · 3 sets · 1 session");
  });

  it("reports in kg when that's what the owner logs", async () => {
    const kgWorkouts = [workout({ id: "k1", title: "Legs", startedLocal: "2026-11-02T08:00", unit: "kg", volumeKg: 1500, workingSets: 3 })];
    const kgSets = sets("k1", "squat-barbell", 0, [x(100, 5, { unit: "kg" }), x(100, 5, { unit: "kg" }), x(110, 3, { unit: "kg" })]);
    const s = store(kgWorkouts, kgSets);
    expect(await ask("squat pr", s)).toBe(
      ["squat (barbell) prs:", "heaviest 110 kg × 3 · mon nov 2", "best e1rm 121 kg (110×3) · mon nov 2", `https://www.andrewzhou.org/lifts/${publicLiftId("k1")}`].join("\n"),
    );
    expect(await ask("volume this week", s)).toBe("volume this week: 1,500 kg · 1 workout · 3 sets");
  });

  it("no public id secret means no lift-only links", async () => {
    delete process.env.LIFT_PUBLIC_ID_SECRET;
    const prev = process.env.AUTH_SECRET;
    delete process.env.AUTH_SECRET;
    try {
      expect(await ask("best deadlift")).not.toMatch(/https?:/);
    } finally {
      if (prev !== undefined) process.env.AUTH_SECRET = prev;
    }
  });

  it("prints example q→a pairs", async () => {
    const qs = [
      "what did i bench last week",
      "squat pr",
      "best deadlift",
      "how many workouts this month",
      "last leg day",
      "volume this week",
      "ohp history",
      "when did i last train back",
      "e1rm bench",
      "what did i do last week",
      "thanks",
    ];
    const out: string[] = [];
    for (const t of qs) out.push(`> ${t}\n${await ask(t)}`);
    console.log(out.join("\n\n"));
    expect(out).toHaveLength(qs.length);
  });
});

describe("pure helpers", () => {
  beforeEach(() => {
    process.env.LIFT_PUBLIC_ID_SECRET = "test-secret";
  });

  it("links only public pages", () => {
    const base = { id: "w", status: "finished", linkCount: 0, publicActivityId: null };
    expect(workoutPublicUrl(base)).toBe(`https://www.andrewzhou.org/lifts/${publicLiftId("w")}`);
    expect(workoutPublicUrl({ ...base, linkCount: 2, publicActivityId: 5 })).toBe("https://www.andrewzhou.org/activities/5");
    // linked to a private recording: the workout has no public page anywhere
    expect(workoutPublicUrl({ ...base, linkCount: 1 })).toBeNull();
    expect(workoutPublicUrl({ ...base, status: "active" })).toBeNull();
    expect(workoutPublicUrl({ ...base, status: "discarded", linkCount: 1, publicActivityId: 5 })).toBeNull();
  });

  it("display unit is the majority, lb on ties", () => {
    expect(displayUnit(["kg", "kg", "lb"])).toBe("kg");
    expect(displayUnit(["kg", "lb"])).toBe("lb");
    expect(displayUnit([null])).toBe("lb");
  });

  it("muscle groups match by title or real load", () => {
    const legs = { type: "region" as const, label: "leg", regions: ["quads" as const] };
    expect(workoutHits({ title: "Leg Day", muscleLoad: {} }, legs)).toBe(true);
    expect(workoutHits({ title: "Legs", muscleLoad: {} }, legs)).toBe(true);
    expect(workoutHits({ title: "Full Body", muscleLoad: { quads: 0.6 } }, legs)).toBe(true);
    expect(workoutHits({ title: "Upper", muscleLoad: { quads: 0.2 } }, legs)).toBe(false);
    expect(workoutHits({ title: "Upper", muscleLoad: { quads: "bad" as unknown as number } }, legs)).toBe(false);
  });

  it("sessions skip warm-ups and unfinished sets", () => {
    const [push1, push2] = sessionsOf(WORKOUTS, SETS.filter((s) => s.exerciseId === "bench-press-barbell"));
    expect(push1.working).toHaveLength(3);
    expect(push1.sets).toHaveLength(4);
    expect(push2.working).toHaveLength(3);
    expect(Math.round(push2.bestE1rmKg! * 2.2046226218)).toBe(222);
  });
});
