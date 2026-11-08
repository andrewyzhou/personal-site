// the one place a lift workout becomes public data. rules:
//   - deleted, discarded or unfinished workouts are never served
//   - a workout linked to a recording is shown only on that recording's page,
//     and only while that recording is public (the page 404s otherwise)
//   - lift-only workouts (no links) get /lifts/[publicId] and a calendar entry.
//     urls carry an hmac of the id, never the id itself (see public-id.ts)
//   - workout notes and set notes never leave the db
//   - start times are floored to the privacy coarsening step, like activities

import { and, asc, desc, eq, inArray, isNull, notExists, sql } from "drizzle-orm";
import { unstable_cache } from "next/cache";
import {
  LB_PER_KG,
  MUSCLE_REGIONS,
  detectWorkoutPrs,
  e1rm,
  fromKg,
  getExercise,
  muscleLoadForExercises,
  toKg,
  type HistorySet,
  type MuscleRegion,
  type PrHit,
  type PrKind,
  type SetKind,
  type WeightUnit,
} from "lift-core";
import {
  exercises as exercisesTable,
  getDb,
  liftSets,
  liftWorkoutActivities,
  liftWorkoutExercises,
  liftWorkouts,
  type ActivityRow,
  type LiftSetRow,
  type LiftWorkoutExerciseRow,
  type LiftWorkoutRow,
} from "@/lib/db";
import { isPublic } from "@/lib/public-activity";
import { coarsenStart, loadPrivacySettings } from "@/lib/privacy/settings";
import type { CalendarActivity } from "@/lib/calendar-activity";
import { log } from "@/lib/log";
import { isPublicLiftId, publicLiftId, publicLiftIdsEnabled } from "./public-id";
import { LIFT_PUBLIC_TAG } from "./revalidate";

// ---------------------------------------------------------------------------
// inputs: only the columns the serializer may read (no notes anywhere)

export type LiftWorkoutInput = Pick<
  LiftWorkoutRow,
  "id" | "title" | "startedLocal" | "durationS" | "status" | "deletedAt" | "muscleLoad"
>;

export type LiftExerciseInput = Pick<LiftWorkoutExerciseRow, "id" | "exerciseId" | "position" | "nameRaw"> & {
  /** exercises.name for the row (custom exercises live only there) */
  customName: string | null;
};

export type LiftSetInput = Pick<
  LiftSetRow,
  "workoutExerciseId" | "position" | "kind" | "weight" | "unit" | "reps" | "durationS" | "distanceM" | "bodyweight" | "completed"
>;

// ---------------------------------------------------------------------------
// output

export interface PublicSetGroup {
  kind: SetKind;
  count: number;
  /** "5", "1:00", "400 m in 1:30" */
  effort: string;
  /** "185 lb", "+25 lb", "-40 lb", or null for bodyweight/unloaded */
  load: string | null;
  /** "3×5 @ 185 lb" */
  label: string;
}

export interface PublicPr {
  exerciseId: string;
  exerciseName: string;
  kind: PrKind;
  /** "e1rm 216 lb", "heaviest 205 lb × 3", "8 reps @ 185 lb", "volume 2,775 lb" */
  label: string;
}

export interface PublicLiftExercise {
  exerciseId: string;
  name: string;
  warmups: PublicSetGroup[];
  working: PublicSetGroup[];
  workingSets: number;
  /** "205 lb × 3" */
  topSet: string | null;
  /** "e1rm 232 lb" value, rounded, in the exercise's display unit */
  bestE1rm: string | null;
  prs: PublicPr[];
}

// no internal id here: it would leak the share link or the exact start minute
export interface PublicLiftWorkout {
  title: string;
  /** 'YYYY-MM-DD' local */
  date: string;
  /** 'HH:MM' local, coarsened; null when the surface shouldn't show a time */
  startTime: string | null;
  durationS: number | null;
  exercises: PublicLiftExercise[];
  workingSets: number;
  /** total volume in `volumeUnit`, rounded */
  volume: number;
  /** the unit most working sets were logged in */
  volumeUnit: WeightUnit;
  /** region -> 0..1, most-loaded region = 1 */
  muscleLoad: Partial<Record<MuscleRegion, number>>;
  /** most-loaded regions first */
  topRegions: MuscleRegion[];
  prs: PublicPr[];
}

// ---------------------------------------------------------------------------
// privacy filters

/** deleted, discarded or still-running workouts never go public */
export function isPublishableWorkout(w: Pick<LiftWorkoutRow, "deletedAt" | "status">): boolean {
  return w.deletedAt === null && w.status === "finished";
}

/** lift-only = publishable with no linked recording (those show on the recording's page instead) */
export function isLiftOnlyPublic(w: Pick<LiftWorkoutRow, "deletedAt" | "status">, linkCount: number): boolean {
  return isPublishableWorkout(w) && linkCount === 0;
}

const LIFT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_:-]{0,99}$/;

/** shape check for ids in urls ("share-caterxeu", uuids) before they reach a query */
export function isValidLiftId(id: string): boolean {
  return LIFT_ID_RE.test(id);
}

// ---------------------------------------------------------------------------
// formatting

const fmtNum = (n: number) => (Math.round(n * 100) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 });

function asUnit(u: string | null): WeightUnit | null {
  return u === "lb" || u === "kg" ? u : null;
}

function asKind(k: string): SetKind {
  return k === "warmup" || k === "drop" || k === "failure" ? k : "normal";
}

function clock(totalS: number): string {
  const s = Math.max(0, Math.round(totalS));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

function distance(m: number): string {
  return m < 1000 ? `${fmtNum(Math.round(m))} m` : `${fmtNum(m / 1609.344)} mi`;
}

export function formatLoad(set: Pick<LiftSetInput, "weight" | "unit" | "bodyweight">): string | null {
  const unit = asUnit(set.unit) ?? "lb";
  const w = set.weight;
  if (w === null || !Number.isFinite(w) || w === 0) return null;
  // relative loads keep their sign so "+25 lb" (weighted) and "-40 lb" (assisted) read right
  if (set.bodyweight) return `${w > 0 ? "+" : "-"}${fmtNum(Math.abs(w))} ${unit}`;
  return `${fmtNum(w)} ${unit}`;
}

export function formatEffort(set: Pick<LiftSetInput, "reps" | "durationS" | "distanceM">): string {
  const parts: string[] = [];
  if (set.distanceM !== null && set.distanceM > 0) parts.push(distance(set.distanceM));
  if (set.durationS !== null && set.durationS > 0) parts.push(clock(set.durationS));
  if (parts.length === 2) return `${parts[0]} in ${parts[1]}`;
  if (set.reps !== null && set.reps > 0) return parts.length ? `${set.reps} × ${parts[0]}` : String(set.reps);
  return parts[0] ?? "—";
}

const KIND_SUFFIX: Partial<Record<SetKind, string>> = { drop: " · drop", failure: " · to failure" };

/** consecutive identical sets collapse: 185×5, 185×5, 185×5 -> "3×5 @ 185 lb" */
export function groupSets(sets: readonly LiftSetInput[]): PublicSetGroup[] {
  const groups: PublicSetGroup[] = [];
  const keys: string[] = [];
  for (const set of sets) {
    const kind = asKind(set.kind);
    const effort = formatEffort(set);
    const load = formatLoad(set);
    const key = `${kind}|${effort}|${load ?? ""}`;
    if (keys[keys.length - 1] === key) {
      groups[groups.length - 1].count++;
      continue;
    }
    keys.push(key);
    groups.push({ kind, count: 1, effort, load, label: "" });
  }
  for (const g of groups) g.label = `${g.count}×${g.effort}${g.load ? ` @ ${g.load}` : ""}${KIND_SUFFIX[g.kind] ?? ""}`;
  return groups;
}

/** floor an 'HH:MM' to the coarsening step; same rule as the activity publisher */
export function coarsenLocalTime(hhmm: string, stepMin: number): string {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return hhmm;
  const floored = coarsenStart(new Date(Date.UTC(1970, 0, 1, +m[1], +m[2])), stepMin);
  return floored.toISOString().slice(11, 16);
}

/** sanitized normalized load: known regions only, clamped to 0..1, renormalized to max 1 */
export function sanitizeMuscleLoad(raw: unknown): Partial<Record<MuscleRegion, number>> {
  const out: Partial<Record<MuscleRegion, number>> = {};
  if (!raw || typeof raw !== "object") return out;
  const src = raw as Record<string, unknown>;
  let max = 0;
  for (const r of MUSCLE_REGIONS) {
    const v = src[r];
    if (typeof v === "number" && Number.isFinite(v) && v > 0) {
      out[r] = v;
      if (v > max) max = v;
    }
  }
  if (max > 0) for (const r of Object.keys(out) as MuscleRegion[]) out[r] = Math.min(1, out[r]! / max);
  return out;
}

export function topRegions(load: Partial<Record<MuscleRegion, number>>, n = MUSCLE_REGIONS.length): MuscleRegion[] {
  return MUSCLE_REGIONS.filter((r) => (load[r] ?? 0) > 0)
    .sort((a, b) => load[b]! - load[a]! || MUSCLE_REGIONS.indexOf(a) - MUSCLE_REGIONS.indexOf(b))
    .slice(0, n);
}

/** `relative`: the loads are added to bodyweight ("+30 lb"), not the whole load */
function prLabel(hit: PrHit, unit: WeightUnit, relative = false): string {
  const u = hit.set?.unit ?? unit;
  const plus = relative ? "+" : "";
  switch (hit.kind) {
    case "e1rm":
      return `e1rm ${fmtNum(Math.round(fromKg(hit.value, u)))} ${u}`;
    case "weight":
      return hit.set
        ? `heaviest ${plus}${fmtNum(hit.set.weight)} ${hit.set.unit} × ${hit.set.reps}`
        : `heaviest ${plus}${fmtNum(Math.round(fromKg(hit.value, u)))} ${u}`;
    case "reps_at_weight":
      return hit.set ? `${hit.set.reps} reps @ ${plus}${fmtNum(hit.set.weight)} ${hit.set.unit}` : `${hit.value} reps`;
    case "volume":
      return `volume ${fmtNum(Math.round(fromKg(hit.value, u)))} ${u}`;
    default:
      return String(hit.kind);
  }
}

const PR_ORDER: PrKind[] = ["e1rm", "weight", "reps_at_weight", "volume"];

// "+30 lb" on a pull-up isn't the whole load: no max to estimate, no tonnage to compare
const RELATIVE_DROPS: ReadonlySet<PrKind> = new Set(["e1rm", "volume"]);

/** a completed working set whose load is added to bodyweight (weighted pull-ups, dips) */
function isAddedLoad(s: Pick<LiftSetInput, "kind" | "completed" | "bodyweight" | "weight">): boolean {
  return s.completed && s.kind !== "warmup" && s.bodyweight && s.weight !== null && s.weight > 0;
}

/** prs for this workout; lift-core's detector may not be available yet, so any throw means none */
export function safeWorkoutPrs(history: readonly HistorySet[], workoutId: string): PrHit[] {
  if (!history.length) return [];
  try {
    const hits = detectWorkoutPrs(history, workoutId);
    return Array.isArray(hits) ? hits : [];
  } catch {
    return [];
  }
}

/** wall-clock 'YYYY-MM-DDTHH:MM' -> sortable ms (zone doesn't matter for ordering one person's history) */
export function localMs(startedLocal: string): number {
  const ms = Date.parse(`${startedLocal}:00Z`);
  return Number.isFinite(ms) ? ms : 0;
}

export interface SerializeOptions {
  /** every set (any workout) of the exercises in this one, for pr detection */
  history?: readonly HistorySet[];
  coarsenStartMin?: number;
  /** false on the activity page: the recording's own (coarsened) time is already shown */
  showTime?: boolean;
}

export function serializeLiftWorkout(
  workout: LiftWorkoutInput,
  exercises: readonly LiftExerciseInput[],
  sets: readonly LiftSetInput[],
  options: SerializeOptions = {},
): PublicLiftWorkout | null {
  if (!isPublishableWorkout(workout)) return null;

  const hits = safeWorkoutPrs(options.history ?? [], workout.id);
  const catalogIdOf = new Map(exercises.map((e) => [e.id, e.exerciseId]));
  // per catalog exercise, so a lift logged twice in one workout is judged once
  const relative = new Set<string>();
  for (const s of sets) {
    const id = catalogIdOf.get(s.workoutExerciseId);
    if (id !== undefined && isAddedLoad(s)) relative.add(id);
  }
  const setsByExercise = new Map<string, LiftSetInput[]>();
  for (const s of sets) {
    // skipped sets weren't lifted
    if (!s.completed) continue;
    const list = setsByExercise.get(s.workoutExerciseId) ?? [];
    list.push(s);
    setsByExercise.set(s.workoutExerciseId, list);
  }

  let workingSets = 0;
  let volumeKg = 0;
  const unitCounts = { lb: 0, kg: 0 };
  const loadItems: { exerciseId: string; workingSets: number }[] = [];
  const seenPrExercises = new Set<string>();

  const out: PublicLiftExercise[] = [...exercises]
    .sort((a, b) => a.position - b.position)
    .map((ex) => {
      const exSets = (setsByExercise.get(ex.id) ?? []).slice().sort((a, b) => a.position - b.position);
      const warm = exSets.filter((s) => s.kind === "warmup");
      const work = exSets.filter((s) => s.kind !== "warmup");
      const name = getExercise(ex.exerciseId)?.name ?? ex.customName ?? ex.nameRaw;

      let top: { s: LiftSetInput; kg: number; reps: number } | null = null;
      let bestKg: number | null = null;
      for (const s of work) {
        const unit = asUnit(s.unit);
        if (s.weight === null || !(s.weight > 0) || s.reps === null || !(s.reps > 0)) continue;
        const kg = toKg(s.weight, unit ?? "lb");
        // same rule as lift-core's setVolumeKg: without a unit we can't convert
        if (unit) {
          volumeKg += kg * s.reps;
          unitCounts[unit]++;
        }
        if (!top || kg > top.kg + 1e-9 || (Math.abs(kg - top.kg) <= 1e-9 && s.reps > top.reps)) top = { s, kg, reps: s.reps };
        // same rule as the lift bot: an added load can't estimate a max
        if (s.bodyweight) continue;
        const est = e1rm(kg, s.reps);
        if (est !== null && (bestKg === null || est > bestKg)) bestKg = est;
      }
      workingSets += work.length;
      loadItems.push({ exerciseId: ex.exerciseId, workingSets: work.length });

      const displayUnit = asUnit(top?.s.unit ?? null) ?? "lb";
      // an exercise logged twice in one workout gets its prs once, on the first entry
      const rel = relative.has(ex.exerciseId);
      const prs: PublicPr[] = seenPrExercises.has(ex.exerciseId)
        ? []
        : hits
            .filter((h) => h.exerciseId === ex.exerciseId && !(rel && RELATIVE_DROPS.has(h.kind)))
            .sort((a, b) => PR_ORDER.indexOf(a.kind) - PR_ORDER.indexOf(b.kind))
            .map((h) => ({ exerciseId: ex.exerciseId, exerciseName: name, kind: h.kind, label: prLabel(h, displayUnit, rel) }));
      seenPrExercises.add(ex.exerciseId);

      return {
        exerciseId: ex.exerciseId,
        name,
        warmups: groupSets(warm),
        working: groupSets(work),
        workingSets: work.length,
        topSet: top ? `${formatLoad(top.s) ?? `${fmtNum(top.s.weight!)} ${displayUnit}`} × ${top.reps}` : null,
        bestE1rm: bestKg !== null ? `${fmtNum(Math.round(fromKg(bestKg, displayUnit)))} ${displayUnit}` : null,
        prs,
      };
    })
    .filter((e) => e.warmups.length > 0 || e.working.length > 0);

  // stored load is the source of truth; older rows without one are computed from the catalog
  let muscleLoad = sanitizeMuscleLoad(workout.muscleLoad);
  if (Object.keys(muscleLoad).length === 0) muscleLoad = sanitizeMuscleLoad(muscleLoadForExercises(loadItems).normalized);

  const date = workout.startedLocal.slice(0, 10);
  const rawTime = workout.startedLocal.slice(11, 16);
  const showTime = options.showTime ?? true;

  // ties go to lb, the default everywhere else
  const volumeUnit: WeightUnit = unitCounts.kg > unitCounts.lb ? "kg" : "lb";

  return {
    title: workout.title,
    date,
    startTime: showTime && /^\d{2}:\d{2}$/.test(rawTime) ? coarsenLocalTime(rawTime, options.coarsenStartMin ?? 0) : null,
    durationS: workout.durationS !== null && workout.durationS > 0 ? workout.durationS : null,
    exercises: out,
    workingSets,
    volume: Math.round(volumeUnit === "lb" ? volumeKg * LB_PER_KG : volumeKg),
    volumeUnit,
    muscleLoad,
    topRegions: topRegions(muscleLoad),
    prs: out.flatMap((e) => e.prs),
  };
}

// ---------------------------------------------------------------------------
// calendar

/** stable negative id from the public id: never collides with recording ids (positive), reveals nothing more */
export function liftCalendarId(publicId: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < publicId.length; i++) {
    h ^= publicId.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return -((h % 0x7fffffff) + 1);
}

export function liftHref(publicId: string): string {
  return `/lifts/${encodeURIComponent(publicId)}`;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** "3 exercises · 6 sets" */
export function liftSummaryLine(exerciseCount: number, workingSets: number): string {
  return `${plural(exerciseCount, "exercise")} · ${plural(workingSets, "set")}`;
}

/** a lift-only workout as the calendar loader sees it (server side only: carries the internal id) */
export type LiftOnlyRow = Pick<LiftWorkoutRow, "id" | "title" | "startedLocal" | "durationS"> & {
  workingSets: number;
  exerciseCount: number;
};

/** null without a public id secret: no entry beats one that leaks the id */
export function publicLiftCalendarEntry(w: LiftOnlyRow, coarsenStartMin: number): CalendarActivity | null {
  const publicId = publicLiftId(w.id);
  if (!publicId) return null;
  const d = w.durationS !== null && w.durationS > 0 ? w.durationS : 0;
  return {
    id: liftCalendarId(publicId),
    name: w.title,
    type: "WeightTraining",
    date: w.startedLocal.slice(0, 10),
    startTime: coarsenLocalTime(w.startedLocal.slice(11, 16), coarsenStartMin),
    distance: 0,
    duration: d,
    elapsedTime: d,
    totalElevationGain: 0,
    averageSpeed: 0,
    maxSpeed: 0,
    averageHeartrate: null,
    maxHeartrate: null,
    averageCadence: null,
    averageWatts: null,
    maxWatts: null,
    kilojoules: null,
    description: null,
    sufferScore: null,
    href: liftHref(publicId),
    liftSummary: liftSummaryLine(w.exerciseCount, w.workingSets),
  };
}

// ---------------------------------------------------------------------------
// loaders

// dev-only stand-in data (LIFT_PUBLIC_FIXTURE=1); imported only when on, never in production
export function liftFixtureOn(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.LIFT_PUBLIC_FIXTURE === "1";
}
const fixture = () => import("./public-fixture");

// lazy: route tests mock @/lib/db without the lift tables
const workoutCols = () => ({
  id: liftWorkouts.id,
  title: liftWorkouts.title,
  startedLocal: liftWorkouts.startedLocal,
  durationS: liftWorkouts.durationS,
  status: liftWorkouts.status,
  deletedAt: liftWorkouts.deletedAt,
  muscleLoad: liftWorkouts.muscleLoad,
});

const noLinks = () =>
  notExists(
    getDb()
      .select({ one: liftWorkoutActivities.workoutId })
      .from(liftWorkoutActivities)
      .where(eq(liftWorkoutActivities.workoutId, liftWorkouts.id)),
  );

/** exercises, sets and pr history for these workouts (3 queries, run together) */
async function loadDetails(workoutIds: string[]) {
  const db = getDb();
  const [exRows, setRows] = await Promise.all([
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
      .leftJoin(exercisesTable, eq(exercisesTable.id, liftWorkoutExercises.exerciseId))
      .where(inArray(liftWorkoutExercises.workoutId, workoutIds))
      .orderBy(asc(liftWorkoutExercises.position)),
    db
      .select({
        workoutId: liftWorkoutExercises.workoutId,
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
      .where(inArray(liftWorkoutExercises.workoutId, workoutIds)),
  ]);

  const exerciseIds = [...new Set(exRows.map((e) => e.exerciseId))];
  const historyRows = exerciseIds.length
    ? await db
        .select({
          workoutId: liftWorkouts.id,
          startedLocal: liftWorkouts.startedLocal,
          exerciseId: liftWorkoutExercises.exerciseId,
          kind: liftSets.kind,
          weight: liftSets.weight,
          unit: liftSets.unit,
          reps: liftSets.reps,
          completed: liftSets.completed,
        })
        .from(liftSets)
        .innerJoin(liftWorkoutExercises, eq(liftWorkoutExercises.id, liftSets.workoutExerciseId))
        .innerJoin(liftWorkouts, eq(liftWorkouts.id, liftWorkoutExercises.workoutId))
        .where(
          and(
            inArray(liftWorkoutExercises.exerciseId, exerciseIds),
            isNull(liftWorkouts.deletedAt),
            eq(liftWorkouts.status, "finished"),
          ),
        )
    : [];

  const history: HistorySet[] = historyRows.map((r) => ({
    workoutId: r.workoutId,
    startedAt: localMs(r.startedLocal),
    exerciseId: r.exerciseId,
    kind: asKind(r.kind),
    weight: r.weight,
    unit: asUnit(r.unit),
    reps: r.reps,
    completed: r.completed,
  }));
  return { exRows, setRows, history };
}

async function serializeMany(workouts: LiftWorkoutInput[], options: Omit<SerializeOptions, "history">) {
  const live = workouts.filter(isPublishableWorkout);
  if (!live.length) return [];
  const { exRows, setRows, history } = await loadDetails(live.map((w) => w.id));
  return live
    .map((w) =>
      serializeLiftWorkout(
        w,
        exRows.filter((e) => e.workoutId === w.id),
        setRows.filter((s) => s.workoutId === w.id),
        { ...options, history },
      ),
    )
    .filter((w): w is PublicLiftWorkout => w !== null);
}

/**
 * workouts linked to a recording, any role (primary/duplicate/continuation/overrun),
 * each once. a recording without lifts costs one indexed query.
 */
export async function loadActivityLiftWorkouts(activity: Pick<ActivityRow, "id" | "hidden">): Promise<PublicLiftWorkout[]> {
  if (!isPublic(activity)) return [];
  try {
    if (liftFixtureOn()) return await (await fixture()).fixtureActivityWorkouts(activity.id);
    const rows = await getDb()
      .select(workoutCols())
      .from(liftWorkoutActivities)
      .innerJoin(liftWorkouts, eq(liftWorkouts.id, liftWorkoutActivities.workoutId))
      .where(eq(liftWorkoutActivities.activityId, activity.id))
      .orderBy(asc(liftWorkouts.startedLocal));
    const unique = [...new Map(rows.map((r) => [r.id, r])).values()];
    return await serializeMany(unique, { showTime: false });
  } catch (error) {
    // a lift-side problem must never take the recording's page down with it
    log.error("lift:public", "activity lift load failed", error);
    return [];
  }
}

// the public index is bounded: older lift-only workouts drop off the calendar and their pages
export const LIFT_INDEX_LIMIT = 1000;

/** lift-only workouts, newest first (internal ids: never serialize this directly) */
export async function loadLiftOnlyIndex(): Promise<LiftOnlyRow[]> {
  const rows = await getDb()
    .select({
      id: liftWorkouts.id,
      title: liftWorkouts.title,
      startedLocal: liftWorkouts.startedLocal,
      durationS: liftWorkouts.durationS,
      status: liftWorkouts.status,
      deletedAt: liftWorkouts.deletedAt,
      workingSets: liftWorkouts.workingSets,
      exerciseCount: sql<number>`(select count(*) from "lift_workout_exercises" e where e."workout_id" = "lift_workouts"."id")`.mapWith(Number),
    })
    .from(liftWorkouts)
    .where(and(isNull(liftWorkouts.deletedAt), eq(liftWorkouts.status, "finished"), noLinks()))
    .orderBy(desc(liftWorkouts.startedLocal))
    .limit(LIFT_INDEX_LIMIT);
  // filtered again so a query change can never publish a hidden workout
  return rows
    .filter((r) => isLiftOnlyPublic(r, 0))
    .map((r) => ({
      id: r.id,
      title: r.title,
      startedLocal: r.startedLocal,
      durationS: r.durationS,
      workingSets: Number(r.workingSets) || 0,
      exerciseCount: Number(r.exerciseCount) || 0,
    }));
}

// lift ingests don't invalidate the activities cache, so this gets its own tag and a short ttl
const cachedLiftIndex = unstable_cache(loadLiftOnlyIndex, ["lift-only-index-v2"], {
  revalidate: 300,
  tags: [LIFT_PUBLIC_TAG],
});

/** public id -> index row, only for lift-only workouts; raw internal ids never resolve */
export async function resolvePublicLiftId(
  publicId: string,
  index: () => Promise<LiftOnlyRow[]> = cachedLiftIndex,
): Promise<LiftOnlyRow | null> {
  if (!isPublicLiftId(publicId) || !publicLiftIdsEnabled()) return null;
  const rows = await index();
  return rows.find((r) => publicLiftId(r.id) === publicId) ?? null;
}

/** a lift-only workout for /lifts/[publicId]; null for unknown, linked, deleted, discarded or disabled */
export async function loadLiftOnlyWorkout(publicId: string): Promise<PublicLiftWorkout | null> {
  if (liftFixtureOn()) return isPublicLiftId(publicId) ? (await fixture()).fixtureLiftOnlyWorkout(publicId) : null;
  const hit = await resolvePublicLiftId(publicId);
  if (!hit) return null;
  // the index can be up to a ttl old, so the row is re-checked live
  const rows = await getDb()
    .select(workoutCols())
    .from(liftWorkouts)
    .where(and(eq(liftWorkouts.id, hit.id), isNull(liftWorkouts.deletedAt), eq(liftWorkouts.status, "finished"), noLinks()))
    .limit(1);
  if (!rows[0]) return null;
  const { coarsenStartMin } = await loadPrivacySettings();
  const [w] = await serializeMany([rows[0]], { coarsenStartMin });
  return w ?? null;
}

/** title-only lookup for metadata (from the index, no detail queries) */
export async function loadLiftOnlyTitle(publicId: string): Promise<string | null> {
  if (liftFixtureOn()) return (await loadLiftOnlyWorkout(publicId))?.title ?? null;
  return (await resolvePublicLiftId(publicId))?.title ?? null;
}

/** lift-only workouts as calendar entries, newest first; none without a public id secret */
export async function loadLiftCalendar(index: () => Promise<LiftOnlyRow[]> = cachedLiftIndex): Promise<CalendarActivity[]> {
  if (!publicLiftIdsEnabled()) return [];
  const rows = await index();
  const { coarsenStartMin } = await loadPrivacySettings();
  return rows.map((r) => publicLiftCalendarEntry(r, coarsenStartMin)).filter((e): e is CalendarActivity => e !== null);
}

/** calendar entries for /api/activities; any failure is an empty list, never a broken calendar */
export async function liftCalendarEntries(): Promise<CalendarActivity[]> {
  try {
    const entries = liftFixtureOn() ? await (await fixture()).fixtureCalendar() : await loadLiftCalendar();
    return Array.isArray(entries) ? entries : [];
  } catch (error) {
    log.warn("lift:public", "lift calendar load failed", error);
    return [];
  }
}
