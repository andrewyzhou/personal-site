// dev-only stand-in data for the public lift pages (LIFT_PUBLIC_FIXTURE=1, never
// in production). it's raw rows, so the real serializer, privacy filters and
// aggregation all run on it. a few rows exist only to prove they stay hidden:
// a discarded, a deleted and a private-recording workout.

import { desc, eq } from "drizzle-orm";
import { getExercise, type HistorySet } from "lift-core";
import { activities, getDb } from "@/lib/db";
import type { CalendarActivity } from "@/lib/strava";
import {
  isLiftOnlyPublic,
  liftFixtureOn,
  publicLiftCalendarEntry,
  serializeLiftWorkout,
  localMs,
  type PublicLiftWorkout,
} from "./public";
import { buildLiftsOverview, liftToday, type LiftsOverview, type OverviewInput, type StatsSetRow } from "./public-stats";
import { publicLiftId } from "./public-id";

function assertDev() {
  if (!liftFixtureOn()) throw new Error("lift fixture is dev-only");
}

// ---------------------------------------------------------------------------
// program

type Plan = { id: string; sets: number; reps: number; start: number; step: number; unit?: "lb" | "kg"; bw?: boolean; timeS?: number };

const DAYS: { title: string; dow: number; plan: Plan[] }[] = [
  {
    title: "push",
    dow: 1,
    plan: [
      { id: "bench-press-barbell", sets: 4, reps: 5, start: 165, step: 2.5 },
      { id: "incline-bench-press-dumbbell", sets: 3, reps: 10, start: 50, step: 1.25 },
      { id: "overhead-press-barbell", sets: 3, reps: 6, start: 95, step: 1.25 },
      { id: "lateral-raise-dumbbell", sets: 3, reps: 15, start: 20, step: 0.5 },
      { id: "triceps-pushdown-cable-rope", sets: 3, reps: 12, start: 50, step: 1 },
    ],
  },
  {
    title: "pull",
    dow: 2,
    plan: [
      { id: "pull-up", sets: 4, reps: 6, start: 10, step: 1.25, bw: true },
      { id: "bent-over-row-barbell", sets: 3, reps: 8, start: 135, step: 2.5 },
      { id: "lat-pulldown-cable", sets: 3, reps: 10, start: 120, step: 2.5 },
      { id: "face-pull-cable", sets: 3, reps: 15, start: 40, step: 1 },
      { id: "bicep-curl-dumbbell", sets: 3, reps: 10, start: 25, step: 0.5 },
    ],
  },
  {
    title: "legs",
    dow: 4,
    plan: [
      { id: "squat-barbell", sets: 4, reps: 5, start: 205, step: 5 },
      { id: "romanian-deadlift-barbell", sets: 3, reps: 8, start: 155, step: 5 },
      { id: "leg-extension-machine", sets: 3, reps: 12, start: 100, step: 2.5 },
      { id: "seated-leg-curl-machine", sets: 3, reps: 12, start: 90, step: 2.5 },
      { id: "calf-raise-machine", sets: 4, reps: 12, start: 140, step: 5 },
    ],
  },
  {
    title: "full body",
    dow: 6,
    plan: [
      { id: "deadlift-barbell", sets: 3, reps: 3, start: 255, step: 5 },
      { id: "chest-dip", sets: 3, reps: 10, start: 0, step: 1, bw: true },
      { id: "hip-thrust-barbell", sets: 3, reps: 10, start: 185, step: 5 },
      { id: "hanging-leg-raise", sets: 3, reps: 12, start: 0, step: 0, bw: true },
      { id: "plank", sets: 2, reps: 0, start: 0, step: 0, timeS: 60 },
    ],
  },
];

// tiny deterministic prng so the fixture is stable between reloads
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const round = (n: number, to: number) => Math.round(n / to) * to;

function dateAdd(date: string, n: number): string {
  const ms = Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) + n * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

function mondayOf(date: string): string {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  return dateAdd(date, -((dow + 6) % 7));
}

function addWorkout(out: OverviewInput, id: string, title: string, startedLocal: string, plan: Plan[], week: number, r: () => number, extra: Partial<OverviewInput["workouts"][number]> = {}) {
  out.workouts.push({ id, title, startedLocal, durationS: 3000 + Math.round(r() * 1800), status: "finished", deletedAt: null, muscleLoad: {}, ...extra });
  plan.forEach((p, i) => {
    const weId = `${id}:${i}`;
    out.exercises.push({ id: weId, workoutId: id, exerciseId: p.id, position: i, nameRaw: getExercise(p.id)?.name ?? p.id, customName: null });
    const sets: StatsSetRow[] = [];
    const unit = p.unit ?? "lb";
    const top = p.start > 0 ? round(p.start + p.step * week, 2.5) : 0;
    // warm-ups on the big barbell lifts
    if (p.id.endsWith("-barbell") && top > 95) {
      sets.push({ workoutExerciseId: weId, position: 0, kind: "warmup", weight: 45, unit, reps: 10, durationS: null, distanceM: null, bodyweight: false, completed: true });
      sets.push({ workoutExerciseId: weId, position: 1, kind: "warmup", weight: round(top * 0.6, 5), unit, reps: 5, durationS: null, distanceM: null, bodyweight: false, completed: true });
    }
    for (let j = 0; j < p.sets; j++) {
      // last set sometimes grinds out an extra rep (that's where rep prs come from)
      const reps = p.timeS ? null : p.reps + (j === p.sets - 1 && r() < 0.35 ? 1 : 0) - (j > 1 && r() < 0.2 ? 1 : 0);
      sets.push({
        workoutExerciseId: weId,
        position: sets.length,
        kind: j === p.sets - 1 && p.id === "lateral-raise-dumbbell" ? "drop" : "normal",
        weight: p.bw ? (top > 0 ? top : null) : p.timeS ? null : top,
        unit: p.timeS ? null : unit,
        reps,
        durationS: p.timeS ? p.timeS + 15 * j : null,
        distanceM: null,
        bodyweight: !!p.bw,
        completed: !(j === p.sets - 1 && r() < 0.05),
      });
    }
    out.sets.push(...sets);
  });
}

/** 16 weeks of a push/pull/legs/full program ending today, plus the never-shown rows */
export function buildFixtureInput(today: string, publicActivities: { id: number; date: string }[] = []): OverviewInput {
  const out: OverviewInput = { workouts: [], links: [], exercises: [], sets: [] };
  const r = rng(20261104);
  const thisMonday = mondayOf(today);
  const WEEKS = 16;
  for (let wk = 0; wk < WEEKS; wk++) {
    const monday = dateAdd(thisMonday, -7 * (WEEKS - 1 - wk));
    for (const day of DAYS) {
      const date = dateAdd(monday, day.dow - 1);
      if (date > today) continue;
      // a missed session now and then, and a deload-ish light week
      if (r() < 0.12 || (wk === 9 && day.dow === 6)) continue;
      const hh = String(17 + Math.floor(r() * 3)).padStart(2, "0");
      const mm = String(Math.floor(r() * 60)).padStart(2, "0");
      addWorkout(out, `fixture-${date}-${day.title.replace(" ", "")}`, day.title, `${date}T${hh}:${mm}`, day.plan, wk, r);
    }
  }

  // recordings that exist and are public get a linked workout on their date
  publicActivities.slice(0, 4).forEach((a, i) => {
    const id = `fixture-linked-${a.id}`;
    const day = DAYS[i % DAYS.length];
    addWorkout(out, id, `${day.title} (watch)`, `${a.date}T07:30`, day.plan, WEEKS - 2, r);
    out.links.push({ workoutId: id, activityId: a.id, role: "primary", activityHidden: false });
  });

  // must never surface anywhere: private recording, discarded, deleted
  addWorkout(out, "fixture-private-recording", "SHOULD NOT SHOW private", `${dateAdd(today, -1)}T06:00`, DAYS[0].plan, WEEKS + 6, r);
  out.links.push({ workoutId: "fixture-private-recording", activityId: 999_999_999, role: "primary", activityHidden: true });
  addWorkout(out, "fixture-discarded", "SHOULD NOT SHOW discarded", `${dateAdd(today, -2)}T06:00`, DAYS[1].plan, WEEKS + 6, r, { status: "discarded" });
  addWorkout(out, "fixture-deleted", "SHOULD NOT SHOW deleted", `${dateAdd(today, -3)}T06:00`, DAYS[2].plan, WEEKS + 6, r, { deletedAt: new Date() });
  return out;
}

// ---------------------------------------------------------------------------
// serving (each mirrors a real loader in public.ts / public-stats.ts)

let memo: { today: string; input: Promise<OverviewInput> } | null = null;

async function realPublicActivities(): Promise<{ id: number; date: string }[]> {
  try {
    const rows = await getDb()
      .select({ id: activities.id, date: activities.localDate })
      .from(activities)
      .where(eq(activities.hidden, false))
      .orderBy(desc(activities.localDate))
      .limit(4);
    return rows.map((r) => ({ id: Number(r.id), date: String(r.date) }));
  } catch {
    return [];
  }
}

export function fixtureInput(): Promise<OverviewInput> {
  assertDev();
  const today = liftToday();
  if (!memo || memo.today !== today) memo = { today, input: realPublicActivities().then((a) => buildFixtureInput(today, a)) };
  return memo.input;
}

export async function fixtureOverview(): Promise<LiftsOverview> {
  return buildLiftsOverview(await fixtureInput(), { today: liftToday() });
}

function serializeFrom(input: OverviewInput, workoutId: string, showTime: boolean): PublicLiftWorkout | null {
  const w = input.workouts.find((x) => x.id === workoutId);
  if (!w) return null;
  const exs = input.exercises.filter((e) => e.workoutId === w.id);
  const exIds = new Set(exs.map((e) => e.id));
  const exerciseIds = new Set(exs.map((e) => e.exerciseId));
  const exOf = new Map(input.exercises.map((e) => [e.id, e]));
  const wOf = new Map(input.workouts.map((x) => [x.id, x]));
  const history = input.sets.flatMap((s): HistorySet[] => {
    const e = exOf.get(s.workoutExerciseId);
    const ww = e && wOf.get(e.workoutId);
    if (!e || !ww || !exerciseIds.has(e.exerciseId) || ww.deletedAt !== null || ww.status !== "finished") return [];
    const unit = s.unit === "lb" || s.unit === "kg" ? s.unit : null;
    const kind = s.kind === "warmup" || s.kind === "drop" || s.kind === "failure" ? s.kind : "normal";
    return [{ workoutId: ww.id, startedAt: localMs(ww.startedLocal), exerciseId: e.exerciseId, kind, weight: s.weight, unit, reps: s.reps, completed: s.completed }];
  });
  return serializeLiftWorkout(w, exs, input.sets.filter((s) => exIds.has(s.workoutExerciseId)), { history, showTime, coarsenStartMin: 15 });
}

function liftOnlyIds(input: OverviewInput): string[] {
  const linked = new Set(input.links.map((l) => l.workoutId));
  return input.workouts.filter((w) => isLiftOnlyPublic(w, linked.has(w.id) ? 1 : 0)).map((w) => w.id);
}

export async function fixtureLiftOnlyWorkout(publicId: string): Promise<PublicLiftWorkout | null> {
  const input = await fixtureInput();
  const id = liftOnlyIds(input).find((x) => publicLiftId(x) === publicId);
  return id ? serializeFrom(input, id, true) : null;
}

export async function fixtureActivityWorkouts(activityId: number): Promise<PublicLiftWorkout[]> {
  const input = await fixtureInput();
  return input.links
    .filter((l) => l.activityId === activityId && !l.activityHidden)
    .map((l) => serializeFrom(input, l.workoutId, false))
    .filter((w): w is PublicLiftWorkout => w !== null);
}

export async function fixtureCalendar(): Promise<CalendarActivity[]> {
  const input = await fixtureInput();
  const ids = new Set(liftOnlyIds(input));
  return input.workouts
    .filter((w) => ids.has(w.id))
    .sort((a, b) => b.startedLocal.localeCompare(a.startedLocal))
    .map((w) => {
      const exs = input.exercises.filter((e) => e.workoutId === w.id);
      const exIds = new Set(exs.map((e) => e.id));
      const workingSets = input.sets.filter((s) => exIds.has(s.workoutExerciseId) && s.completed && s.kind !== "warmup").length;
      return publicLiftCalendarEntry({ id: w.id, title: w.title, startedLocal: w.startedLocal, durationS: w.durationS, workingSets, exerciseCount: exs.length }, 15);
    })
    .filter((e): e is CalendarActivity => e !== null);
}
