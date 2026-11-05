// the /lifts index: weekly sets per muscle group, a pr feed and recent
// workouts. same privacy rules as public.ts, applied before anything is
// counted:
//   - only publishable workouts count: lift-only ones with a public id, or
//     ones linked to a recording that is itself public
//   - prs compare against the full history (private sessions included, so
//     "previous best" stays honest) but only hits in publishable workouts show
//   - output carries public hrefs and dates only: no internal ids, no times, no notes

import { and, eq, isNull } from "drizzle-orm";
import { unstable_cache } from "next/cache";
import {
  LB_PER_KG,
  getExercise,
  toKg,
  type HistorySet,
  type MuscleRegion,
  type PrKind,
  type SetKind,
  type WeightUnit,
} from "lift-core";
import {
  activities,
  exercises as exercisesTable,
  getDb,
  liftSets,
  liftWorkoutActivities,
  liftWorkoutExercises,
  liftWorkouts,
} from "@/lib/db";
import { isPublic } from "@/lib/public-activity";
import { log } from "@/lib/log";
import {
  LIFT_INDEX_LIMIT,
  isPublishableWorkout,
  liftFixtureOn,
  liftHref,
  localMs,
  serializeLiftWorkout,
  type LiftExerciseInput,
  type LiftSetInput,
  type LiftWorkoutInput,
  type PublicLiftWorkout,
} from "./public";
import { publicLiftId } from "./public-id";
import { LIFT_PUBLIC_TAG } from "./revalidate";
import { liftTimezone, utcToLocal } from "./time";

// ---------------------------------------------------------------------------
// muscle groups: the 20 figure regions folded into what a weekly view needs

export type MuscleGroupKey = "chest" | "shoulders" | "arms" | "back" | "core" | "glutes" | "legs" | "neck";

export interface MuscleGroup {
  key: MuscleGroupKey;
  label: string;
  regions: readonly MuscleRegion[];
}

export const MUSCLE_GROUPS: readonly MuscleGroup[] = [
  { key: "chest", label: "chest", regions: ["chest"] },
  { key: "shoulders", label: "shoulders", regions: ["front_delts", "side_delts", "rear_delts"] },
  { key: "arms", label: "arms", regions: ["biceps", "triceps", "forearms"] },
  { key: "back", label: "back", regions: ["lats", "upper_back", "traps", "lower_back"] },
  { key: "core", label: "core", regions: ["abs", "obliques"] },
  { key: "glutes", label: "glutes", regions: ["glutes"] },
  { key: "legs", label: "legs", regions: ["quads", "hamstrings", "adductors", "abductors", "calves"] },
  { key: "neck", label: "neck", regions: ["neck"] },
];

// shown only when something trained it, so the chart doesn't carry an empty row forever
const OPTIONAL_GROUPS: ReadonlySet<MuscleGroupKey> = new Set(["neck"]);

const GROUP_OF = new Map<MuscleRegion, MuscleGroupKey>();
for (const g of MUSCLE_GROUPS) for (const r of g.regions) GROUP_OF.set(r, g.key);

export const PRIMARY_SET_WEIGHT = 1;
export const SECONDARY_SET_WEIGHT = 0.5;

/**
 * per-set credit each group gets from one exercise: 1 if any of its regions is
 * primary, else 0.5 if any is secondary. a group counts once per set, so a
 * press hitting front and side delts is one shoulder set, not two.
 */
export function groupWeights(primary: readonly MuscleRegion[], secondary: readonly MuscleRegion[]): Partial<Record<MuscleGroupKey, number>> {
  const out: Partial<Record<MuscleGroupKey, number>> = {};
  for (const r of secondary) {
    const g = GROUP_OF.get(r);
    if (g) out[g] = Math.max(out[g] ?? 0, SECONDARY_SET_WEIGHT);
  }
  for (const r of primary) {
    const g = GROUP_OF.get(r);
    if (g) out[g] = PRIMARY_SET_WEIGHT;
  }
  return out;
}

// ---------------------------------------------------------------------------
// dates ('YYYY-MM-DD' wall clock, handled in utc so the machine zone never matters)

function dayMs(date: string): number {
  return Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10));
}

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function addDays(date: string, n: number): string {
  return isoDay(dayMs(date) + n * 86_400_000);
}

/** monday of the week containing `date` */
export function weekStartOf(date: string): string {
  const dow = new Date(dayMs(date)).getUTCDay(); // 0 = sunday
  return addDays(date, -((dow + 6) % 7));
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** "oct 27" */
export function shortDate(date: string): string {
  return `${MONTHS[+date.slice(5, 7) - 1] ?? ""} ${+date.slice(8, 10)}`;
}

// ---------------------------------------------------------------------------
// raw inputs (server side only: these carry internal ids)

export type StatsWorkoutRow = LiftWorkoutInput;

export interface StatsLinkRow {
  workoutId: string;
  activityId: number;
  role: string;
  /** activities.hidden of the linked recording */
  activityHidden: boolean;
}

export type StatsExerciseRow = LiftExerciseInput & { workoutId: string };
export type StatsSetRow = LiftSetInput;

export interface OverviewInput {
  workouts: StatsWorkoutRow[];
  links: StatsLinkRow[];
  exercises: StatsExerciseRow[];
  sets: StatsSetRow[];
}

const ROLE_ORDER = ["primary", "continuation", "overrun", "duplicate"];

/**
 * workout id -> its public page, for publishable workouts only.
 * linked: the first public recording (primary first); none public means never shown.
 * lift-only: /lifts/<public id>, and only within the index the page resolves from.
 */
export function publicWorkoutHrefs(
  workouts: readonly Pick<StatsWorkoutRow, "id" | "startedLocal" | "status" | "deletedAt">[],
  links: readonly StatsLinkRow[],
  publicIdOf: (workoutId: string) => string | null = publicLiftId,
): Map<string, string> {
  const linksOf = new Map<string, StatsLinkRow[]>();
  for (const l of links) {
    const list = linksOf.get(l.workoutId) ?? [];
    list.push(l);
    linksOf.set(l.workoutId, list);
  }
  const out = new Map<string, string>();
  let liftOnlySeen = 0;
  const newestFirst = workouts.filter(isPublishableWorkout).sort((a, b) => b.startedLocal.localeCompare(a.startedLocal));
  for (const w of newestFirst) {
    const own = linksOf.get(w.id);
    if (own && own.length > 0) {
      const pub = own
        .filter((l) => isPublic({ hidden: l.activityHidden }))
        .sort((a, b) => rank(a.role) - rank(b.role) || a.activityId - b.activityId)[0];
      if (pub) out.set(w.id, `/activities/${pub.activityId}`);
      continue;
    }
    // same bound as loadLiftOnlyIndex: past it the page 404s, so no link either
    if (++liftOnlySeen > LIFT_INDEX_LIMIT) continue;
    const pid = publicIdOf(w.id);
    if (pid) out.set(w.id, liftHref(pid));
  }
  return out;
}

function rank(role: string): number {
  const i = ROLE_ORDER.indexOf(role);
  return i === -1 ? ROLE_ORDER.length : i;
}

// ---------------------------------------------------------------------------
// weekly volume

export interface VolumeEntry {
  /** 'YYYY-MM-DD' */
  date: string;
  exercises: { exerciseId: string; workingSets: number; tonnageKg: number }[];
}

export interface WeekVolume {
  /** monday, 'YYYY-MM-DD' */
  start: string;
  /** muscle-weighted working sets per group */
  sets: Record<MuscleGroupKey, number>;
  /** kg lifted by exercises where the group is primary */
  tonnageKg: Record<MuscleGroupKey, number>;
  workouts: number;
  /** plain working sets (not muscle-weighted) */
  workingSets: number;
  totalTonnageKg: number;
}

const zeroGroups = (): Record<MuscleGroupKey, number> =>
  Object.fromEntries(MUSCLE_GROUPS.map((g) => [g.key, 0])) as Record<MuscleGroupKey, number>;

/** `weeks` weeks ending with the one containing `today`, oldest first; unknown exercises add sets but no muscles */
export function weeklyMuscleVolume(entries: readonly VolumeEntry[], today: string, weeks = 12): WeekVolume[] {
  const last = weekStartOf(today);
  const out: WeekVolume[] = [];
  const byStart = new Map<string, WeekVolume>();
  for (let i = weeks - 1; i >= 0; i--) {
    const w: WeekVolume = { start: addDays(last, -7 * i), sets: zeroGroups(), tonnageKg: zeroGroups(), workouts: 0, workingSets: 0, totalTonnageKg: 0 };
    out.push(w);
    byStart.set(w.start, w);
  }
  for (const e of entries) {
    const week = byStart.get(weekStartOf(e.date));
    if (!week) continue;
    week.workouts++;
    for (const ex of e.exercises) {
      if (!(ex.workingSets > 0)) continue;
      week.workingSets += ex.workingSets;
      const tonnage = ex.tonnageKg > 0 ? ex.tonnageKg : 0;
      week.totalTonnageKg += tonnage;
      const def = getExercise(ex.exerciseId);
      if (!def) continue;
      for (const [g, weight] of Object.entries(groupWeights(def.primary, def.secondary)) as [MuscleGroupKey, number][]) {
        week.sets[g] += ex.workingSets * weight;
        // tonnage is credited to primary groups only: half a bench press isn't triceps tonnage
        if (weight === PRIMARY_SET_WEIGHT) week.tonnageKg[g] += tonnage;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// overview (what the page gets: public, json-safe)

export interface OverviewWeek {
  start: string;
  /** "oct 27" */
  label: string;
  sets: Record<MuscleGroupKey, number>;
  /** in `unit`, rounded */
  tonnage: Record<MuscleGroupKey, number>;
  workouts: number;
  workingSets: number;
  totalTonnage: number;
}

export interface PrFeedItem {
  date: string;
  href: string;
  workoutTitle: string;
  exerciseName: string;
  /** every record that exercise set that day, e1rm first */
  records: { kind: PrKind; label: string }[];
}

export interface RecentLiftWorkout {
  date: string;
  href: string;
  /** shown on a recording's page (vs its own lift page) */
  linked: boolean;
  title: string;
  exercises: string[];
  workingSets: number;
  volume: number;
  volumeUnit: WeightUnit;
  muscleLoad: PublicLiftWorkout["muscleLoad"];
  topRegions: MuscleRegion[];
  prCount: number;
}

export interface LiftsOverview {
  /** the date the window ends on, YYYY-MM-DD */
  today: string;
  weeks: OverviewWeek[];
  /** groups to draw, fixed order */
  groups: { key: MuscleGroupKey; label: string }[];
  unit: WeightUnit;
  window: { workouts: number; workingSets: number; tonnage: number; weeks: number };
  prs: PrFeedItem[];
  recent: RecentLiftWorkout[];
  /** week start -> publishable totals, all time (for "this week" lines) */
  weekTotals: Record<string, { workouts: number; workingSets: number }>;
}

export interface OverviewOptions {
  today: string;
  publicIdOf?: (workoutId: string) => string | null;
  weeks?: number;
  prLimit?: number;
  recentLimit?: number;
  /** newest publishable workouts scanned for prs (bounds the work on a long history) */
  prScanLimit?: number;
}

function asKind(k: string): SetKind {
  return k === "warmup" || k === "drop" || k === "failure" ? k : "normal";
}

function asUnit(u: string | null): WeightUnit | null {
  return u === "lb" || u === "kg" ? u : null;
}

export function buildLiftsOverview(input: OverviewInput, options: OverviewOptions): LiftsOverview {
  const { today, weeks = 12, prLimit = 20, recentLimit = 10, prScanLimit = 200 } = options;
  const hrefs = publicWorkoutHrefs(input.workouts, input.links, options.publicIdOf ?? publicLiftId);
  const linkedIds = new Set(input.links.map((l) => l.workoutId));

  const live = input.workouts.filter(isPublishableWorkout);
  const liveById = new Map(live.map((w) => [w.id, w]));
  const exById = new Map<string, StatsExerciseRow>();
  const exByWorkout = new Map<string, StatsExerciseRow[]>();
  for (const e of input.exercises) {
    if (!liveById.has(e.workoutId)) continue;
    exById.set(e.id, e);
    const list = exByWorkout.get(e.workoutId) ?? [];
    list.push(e);
    exByWorkout.set(e.workoutId, list);
  }

  const setsByWorkout = new Map<string, StatsSetRow[]>();
  // pr history: every finished workout, public or not, grouped by exercise
  const historyByExercise = new Map<string, HistorySet[]>();
  const unitCounts = { lb: 0, kg: 0 };
  const perExercise = new Map<string, { workingSets: number; tonnageKg: number }>();
  for (const s of input.sets) {
    const ex = exById.get(s.workoutExerciseId);
    if (!ex) continue;
    const w = liveById.get(ex.workoutId)!;
    const list = setsByWorkout.get(w.id) ?? [];
    list.push(s);
    setsByWorkout.set(w.id, list);

    const kind = asKind(s.kind);
    const unit = asUnit(s.unit);
    const h = historyByExercise.get(ex.exerciseId) ?? [];
    h.push({ workoutId: w.id, startedAt: localMs(w.startedLocal), exerciseId: ex.exerciseId, kind, weight: s.weight, unit, reps: s.reps, completed: s.completed });
    historyByExercise.set(ex.exerciseId, h);

    // same counting as the serializer: completed non-warm-up sets, volume needs a unit
    if (!s.completed || kind === "warmup") continue;
    const acc = perExercise.get(ex.id) ?? { workingSets: 0, tonnageKg: 0 };
    acc.workingSets++;
    if (unit && s.weight !== null && s.weight > 0 && s.reps !== null && s.reps > 0) {
      acc.tonnageKg += toKg(s.weight, unit) * s.reps;
      if (hrefs.has(w.id)) unitCounts[unit]++;
    }
    perExercise.set(ex.id, acc);
  }
  const unit: WeightUnit = unitCounts.kg > unitCounts.lb ? "kg" : "lb";
  const fromKgRounded = (kg: number) => Math.round(unit === "lb" ? kg * LB_PER_KG : kg);

  const pub = live.filter((w) => hrefs.has(w.id)).sort((a, b) => b.startedLocal.localeCompare(a.startedLocal) || (a.id < b.id ? 1 : -1));

  // weekly volume + all-time week totals
  const entries: VolumeEntry[] = [];
  const weekTotals: LiftsOverview["weekTotals"] = {};
  for (const w of pub) {
    const date = w.startedLocal.slice(0, 10);
    const exs = (exByWorkout.get(w.id) ?? []).map((e) => ({ exerciseId: e.exerciseId, ...(perExercise.get(e.id) ?? { workingSets: 0, tonnageKg: 0 }) }));
    entries.push({ date, exercises: exs });
    const key = weekStartOf(date);
    const t = (weekTotals[key] ??= { workouts: 0, workingSets: 0 });
    t.workouts++;
    t.workingSets += exs.reduce((s, e) => s + e.workingSets, 0);
  }
  const vol = weeklyMuscleVolume(entries, today, weeks);
  const shown = MUSCLE_GROUPS.filter((g) => !OPTIONAL_GROUPS.has(g.key) || vol.some((wk) => wk.sets[g.key] > 0));
  const round = (r: Record<MuscleGroupKey, number>) =>
    Object.fromEntries(Object.entries(r).map(([k, v]) => [k, fromKgRounded(v)])) as Record<MuscleGroupKey, number>;
  const outWeeks: OverviewWeek[] = vol.map((wk) => ({
    start: wk.start,
    label: shortDate(wk.start),
    sets: wk.sets,
    tonnage: round(wk.tonnageKg),
    workouts: wk.workouts,
    workingSets: wk.workingSets,
    totalTonnage: fromKgRounded(wk.totalTonnageKg),
  }));

  // newest first: serialize until there are enough prs and enough recent rows
  const prs: PrFeedItem[] = [];
  const recent: RecentLiftWorkout[] = [];
  for (let i = 0; i < pub.length && i < prScanLimit; i++) {
    if (prs.length >= prLimit && recent.length >= recentLimit) break;
    const w = pub[i];
    const exs = exByWorkout.get(w.id) ?? [];
    const history = [...new Set(exs.map((e) => e.exerciseId))].flatMap((id) => historyByExercise.get(id) ?? []);
    const s = serializeLiftWorkout(w, exs, setsByWorkout.get(w.id) ?? [], { history, showTime: false });
    if (!s) continue;
    const href = hrefs.get(w.id)!;
    // one row per exercise per workout: e1rm, heaviest and volume usually land together
    for (const e of s.exercises) {
      if (prs.length >= prLimit) break;
      if (e.prs.length === 0) continue;
      prs.push({ date: s.date, href, workoutTitle: s.title, exerciseName: e.name, records: e.prs.map((p) => ({ kind: p.kind, label: p.label })) });
    }
    if (recent.length < recentLimit) {
      recent.push({
        date: s.date,
        href,
        linked: linkedIds.has(w.id),
        title: s.title,
        exercises: s.exercises.map((e) => e.name),
        workingSets: s.workingSets,
        volume: s.volume,
        volumeUnit: s.volumeUnit,
        muscleLoad: s.muscleLoad,
        topRegions: s.topRegions,
        prCount: s.prs.length,
      });
    }
  }

  return {
    weeks: outWeeks,
    groups: shown.map((g) => ({ key: g.key, label: g.label })),
    unit,
    window: {
      workouts: vol.reduce((s, w) => s + w.workouts, 0),
      workingSets: vol.reduce((s, w) => s + w.workingSets, 0),
      tonnage: fromKgRounded(vol.reduce((s, w) => s + w.totalTonnageKg, 0)),
      weeks,
    },
    prs,
    recent,
    weekTotals,
    today,
  };
}

// ---------------------------------------------------------------------------
// loader

/** every finished, live workout with its links, exercises and sets (4 queries, run together) */
export async function loadOverviewInput(): Promise<OverviewInput> {
  const db = getDb();
  const live = and(isNull(liftWorkouts.deletedAt), eq(liftWorkouts.status, "finished"));
  const [workouts, links, exercises, sets] = await Promise.all([
    db
      .select({
        id: liftWorkouts.id,
        title: liftWorkouts.title,
        startedLocal: liftWorkouts.startedLocal,
        durationS: liftWorkouts.durationS,
        status: liftWorkouts.status,
        deletedAt: liftWorkouts.deletedAt,
        muscleLoad: liftWorkouts.muscleLoad,
      })
      .from(liftWorkouts)
      .where(live),
    db
      .select({
        workoutId: liftWorkoutActivities.workoutId,
        activityId: liftWorkoutActivities.activityId,
        role: liftWorkoutActivities.role,
        activityHidden: activities.hidden,
      })
      .from(liftWorkoutActivities)
      .innerJoin(activities, eq(activities.id, liftWorkoutActivities.activityId)),
    db
      .select({
        id: liftWorkoutExercises.id,
        workoutId: liftWorkoutExercises.workoutId,
        exerciseId: liftWorkoutExercises.exerciseId,
        position: liftWorkoutExercises.position,
        nameRaw: liftWorkoutExercises.nameRaw,
        customName: exercisesTable.name,
      })
      .from(liftWorkoutExercises)
      .innerJoin(liftWorkouts, eq(liftWorkouts.id, liftWorkoutExercises.workoutId))
      .leftJoin(exercisesTable, eq(exercisesTable.id, liftWorkoutExercises.exerciseId))
      .where(live),
    db
      .select({
        workoutExerciseId: liftSets.workoutExerciseId,
        position: liftSets.position,
        kind: liftSets.kind,
        weight: liftSets.weight,
        unit: liftSets.unit,
        reps: liftSets.reps,
        durationS: liftSets.durationS,
        distanceM: liftSets.distanceM,
        bodyweight: liftSets.bodyweight,
        completed: liftSets.completed,
      })
      .from(liftSets)
      .innerJoin(liftWorkoutExercises, eq(liftWorkoutExercises.id, liftSets.workoutExerciseId))
      .innerJoin(liftWorkouts, eq(liftWorkouts.id, liftWorkoutExercises.workoutId))
      .where(live),
  ]);
  return { workouts, links: links.map((l) => ({ ...l, activityId: Number(l.activityId) })), exercises, sets };
}

/** today's date where the lifting happens */
export function liftToday(now = new Date()): string {
  return utcToLocal(now, liftTimezone()).slice(0, 10);
}

async function computeLiftsOverview(): Promise<LiftsOverview> {
  return buildLiftsOverview(await loadOverviewInput(), { today: liftToday() });
}

// the cached value is already public (hrefs and dates only), like the other lift caches
const cachedOverview = unstable_cache(computeLiftsOverview, ["lift-overview-v1"], {
  revalidate: 300,
  tags: [LIFT_PUBLIC_TAG],
});

/** true while `next build` prerenders pages (no request, maybe no db) */
export function isBuildPhase(): boolean {
  return process.env.NEXT_PHASE === "phase-production-build";
}

export interface LoadOverviewOptions {
  /** rethrow instead of returning null, so an isr page keeps its last good render */
  rethrow?: boolean;
}

/** the /lifts index; null when the db can't be read (unless `rethrow`) */
export async function loadLiftsOverview(options: LoadOverviewOptions = {}): Promise<LiftsOverview | null> {
  try {
    if (liftFixtureOn()) return await (await import("./public-fixture")).fixtureOverview();
    return await cachedOverview();
  } catch (error) {
    log.error("lift:public", "lifts overview load failed", error);
    if (options.rethrow) throw error;
    return null;
  }
}

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** "mon, nov 3", with the year only when it isn't `today`'s */
export function liftDateLabel(date: string, today: string): string {
  const dow = WEEKDAYS[new Date(dayMs(date)).getUTCDay()] ?? "";
  const year = date.slice(0, 4) !== today.slice(0, 4) ? `, ${date.slice(0, 4)}` : "";
  return `${dow}, ${shortDate(date)}${year}`;
}

/** "week of nov 3: 4 workouts · 61 working sets", for one workout's page */
export function weekContextLine(overview: Pick<LiftsOverview, "weekTotals" | "today">, date: string): string | null {
  const start = weekStartOf(date);
  const t = overview.weekTotals[start];
  if (!t || t.workouts === 0) return null;
  const when = start === weekStartOf(overview.today) ? "this week" : `week of ${shortDate(start)}`;
  const n = (v: number, w: string) => `${v.toLocaleString("en-US")} ${w}${v === 1 ? "" : "s"}`;
  return `${when}: ${n(t.workouts, "workout")} · ${n(t.workingSets, "working set")}`;
}
