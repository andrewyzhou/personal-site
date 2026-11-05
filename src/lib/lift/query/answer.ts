// pure aggregation + formatting for bot answers. input is plain rows (as the
// query module returns them, or test fixtures); output is short plain text.

import { LB_PER_KG, e1rm, toKg, type Exercise, type MuscleRegion, type WeightUnit } from "lift-core";
import { formatLocalDay, formatSets, SITE_URL } from "../summary";
import type { SetBrief } from "../plan";
import { publicLiftId } from "../public-id";
import type { Subject } from "./intent";
import { daysBetween, type DateWindow } from "./window";

// ---------------------------------------------------------------------------
// rows

export interface QueryWorkout {
  id: string;
  title: string;
  /** 'YYYY-MM-DDTHH:MM' */
  startedLocal: string;
  status: string;
  workingSets: number;
  volumeKg: number;
  muscleLoad: Record<string, number>;
  /** exercise names in order, as logged */
  exerciseNames: string[];
  /** most common unit among the workout's sets */
  unit: string | null;
  /** links to recordings, any visibility */
  linkCount: number;
  /** a linked recording that is public, primary first; null when none is */
  publicActivityId: number | null;
}

export interface QuerySet {
  workoutId: string;
  exercisePosition: number;
  position: number;
  kind: string;
  weight: number | null;
  unit: string | null;
  reps: number | null;
  durationS: number | null;
  distanceM: number | null;
  bodyweight: boolean;
  completed: boolean;
}

export interface AnswerContext {
  /** local 'YYYY-MM-DD' */
  today: string;
}

// ---------------------------------------------------------------------------
// links

/**
 * the workout's public page, or null. same rules as the public serializer:
 * a linked workout lives on its recording's page (only while that's public),
 * a lift-only one on /lifts/<hmac id>; unfinished workouts have no page.
 */
export function workoutPublicUrl(w: Pick<QueryWorkout, "id" | "status" | "linkCount" | "publicActivityId">): string | null {
  if (w.status !== "finished") return null;
  if (w.linkCount > 0) return w.publicActivityId !== null ? `${SITE_URL}/activities/${w.publicActivityId}` : null;
  const publicId = publicLiftId(w.id);
  return publicId ? `${SITE_URL}/lifts/${publicId}` : null;
}

// ---------------------------------------------------------------------------
// helpers

const unitOf = (u: string | null): WeightUnit | null => (u === "kg" || u === "lb" ? u : null);

function plural(n: number, word: string, many = `${word}s`): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? word : many}`;
}

function amount(kg: number, unit: WeightUnit): string {
  return `${Math.round(unit === "lb" ? kg * LB_PER_KG : kg).toLocaleString("en-US")} ${unit}`;
}

function num(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/** "mon nov 2 (2 days ago)" */
function whenText(startedLocal: string, ctx: AnswerContext, rel = true): string {
  const day = formatLocalDay(startedLocal);
  if (!rel) return day;
  const ago = daysBetween(startedLocal.slice(0, 10), ctx.today);
  const tail = ago === 0 ? "today" : ago === 1 ? "yesterday" : ago > 1 ? `${ago} days ago` : null;
  return tail ? `${day} (${tail})` : day;
}

/** the unit the owner logs in: most common across `units`, lb on a tie or nothing */
export function displayUnit(units: readonly (string | null)[]): WeightUnit {
  let kg = 0;
  let lb = 0;
  for (const u of units) {
    if (u === "kg") kg++;
    else if (u === "lb") lb++;
  }
  return kg > lb ? "kg" : "lb";
}

function inWindow(startedLocal: string, w: DateWindow | null): boolean {
  if (!w) return true;
  const d = startedLocal.slice(0, 10);
  return d >= w.start && d < w.end;
}

const isWorking = (s: Pick<QuerySet, "kind" | "completed">) => s.completed && s.kind !== "warmup";

function brief(s: QuerySet): SetBrief {
  return {
    weight: s.weight,
    unit: unitOf(s.unit),
    reps: s.reps,
    durationS: s.durationS,
    distance: s.distanceM,
    distanceUnit: s.distanceM !== null ? "m" : null,
    bodyweight: s.bodyweight,
  };
}

function setKg(s: QuerySet): number | null {
  const unit = unitOf(s.unit) ?? "lb";
  if (s.weight === null || !Number.isFinite(s.weight) || s.weight <= 0) return null;
  return toKg(s.weight, unit);
}

/** weight x reps, kg; same rules as the ingest (no assisted loads, no unit-less sets) */
function setVolumeKg(s: QuerySet): number {
  if (!isWorking(s) || s.weight === null || s.weight <= 0 || unitOf(s.unit) === null) return 0;
  if (s.reps === null || s.reps <= 0) return 0;
  return toKg(s.weight, unitOf(s.unit)!) * s.reps;
}

function setE1rmKg(s: QuerySet): number | null {
  // "+25 lb" on a pull-up isn't the whole load, so it can't estimate a max
  if (!isWorking(s) || s.bodyweight || s.reps === null) return null;
  const kg = setKg(s);
  return kg === null ? null : e1rm(kg, s.reps);
}

function loadText(s: QuerySet): string {
  const u = unitOf(s.unit) ?? "lb";
  const w = s.bodyweight && s.weight !== null && s.weight > 0 ? `+${num(s.weight)}` : num(s.weight ?? 0);
  return `${w} ${u}`;
}

// ---------------------------------------------------------------------------
// sessions of one exercise

export interface Session {
  workout: QueryWorkout;
  sets: QuerySet[];
  working: QuerySet[];
  volumeKg: number;
  bestE1rmKg: number | null;
  bestE1rmSet: QuerySet | null;
}

/** sets grouped by workout, oldest first */
export function sessionsOf(workouts: readonly QueryWorkout[], sets: readonly QuerySet[]): Session[] {
  const byId = new Map(workouts.map((w) => [w.id, w]));
  const map = new Map<string, Session>();
  const sorted = [...sets].sort((a, b) => a.exercisePosition - b.exercisePosition || a.position - b.position);
  for (const s of sorted) {
    const w = byId.get(s.workoutId);
    if (!w) continue;
    let sess = map.get(w.id);
    if (!sess) {
      sess = { workout: w, sets: [], working: [], volumeKg: 0, bestE1rmKg: null, bestE1rmSet: null };
      map.set(w.id, sess);
    }
    sess.sets.push(s);
    if (!isWorking(s)) continue;
    sess.working.push(s);
    sess.volumeKg += setVolumeKg(s);
    const est = setE1rmKg(s);
    if (est !== null && (sess.bestE1rmKg === null || est > sess.bestE1rmKg)) {
      sess.bestE1rmKg = est;
      sess.bestE1rmSet = s;
    }
  }
  return [...map.values()].sort((a, b) => (a.workout.startedLocal < b.workout.startedLocal ? -1 : 1));
}

function sessionLine(s: Session, unit: WeightUnit, ctx: AnswerContext, rel = false): string {
  const parts = [whenText(s.workout.startedLocal, ctx, rel), s.working.length ? formatSets(s.working.map(brief)) : "warm-up only"];
  if (s.bestE1rmKg !== null) parts.push(`e1rm ${amount(s.bestE1rmKg, unit)}`);
  return parts.join(" · ");
}

function exerciseUnit(sets: readonly QuerySet[]): WeightUnit {
  return displayUnit(sets.map((s) => s.unit));
}

const lower = (e: Pick<Exercise, "name">) => e.name.toLowerCase();

function withLinks(lines: string[], ...workouts: (QueryWorkout | null | undefined)[]): string {
  const urls: string[] = [];
  for (const w of workouts) {
    const url = w ? workoutPublicUrl(w) : null;
    if (url && !urls.includes(url)) urls.push(url);
  }
  return [...lines, ...urls].join("\n");
}

const MAX_LINES = 10;

function capped(lines: string[], max = MAX_LINES): string[] {
  return lines.length > max ? [...lines.slice(0, max), `+${lines.length - max} more`] : lines;
}

function windowText(w: DateWindow | null): string {
  return w ? ` ${w.label}` : "";
}

// ---------------------------------------------------------------------------
// exercise answers

export function answerExerciseSets(
  exercise: Exercise,
  window: DateWindow | null,
  workouts: readonly QueryWorkout[],
  sets: readonly QuerySet[],
  ctx: AnswerContext,
): string {
  const all = sessionsOf(workouts, sets);
  const unit = exerciseUnit(sets);
  const name = lower(exercise);
  const shown = all.filter((s) => inWindow(s.workout.startedLocal, window));
  if (!shown.length) {
    const last = all[all.length - 1];
    const hint = last ? ` (last time: ${whenText(last.workout.startedLocal, ctx)})` : "";
    return `no ${name}${windowText(window)}${hint}`;
  }
  const newest = [...shown].reverse();
  const lines = capped(newest.map((s) => sessionLine(s, unit, ctx)));
  return withLinks([`${name}${windowText(window)}:`, ...lines], newest[0].workout);
}

export function answerExerciseLast(
  exercise: Exercise,
  workouts: readonly QueryWorkout[],
  sets: readonly QuerySet[],
  ctx: AnswerContext,
): string {
  const all = sessionsOf(workouts, sets);
  const last = all[all.length - 1];
  if (!last) return `no ${lower(exercise)} logged yet`;
  return withLinks([`last ${lower(exercise)}: ${sessionLine(last, exerciseUnit(sets), ctx, true)}`], last.workout);
}

interface Top {
  set: QuerySet;
  kg: number;
  workout: QueryWorkout;
}

export function answerExerciseBest(
  exercise: Exercise,
  window: DateWindow | null,
  workouts: readonly QueryWorkout[],
  sets: readonly QuerySet[],
  ctx: AnswerContext,
): string {
  const name = lower(exercise);
  const sessions = sessionsOf(workouts, sets).filter((s) => inWindow(s.workout.startedLocal, window));
  const unit = exerciseUnit(sets);
  let heaviest: Top | null = null;
  let best: (Top & { est: number }) | null = null;
  let mostReps: { set: QuerySet; workout: QueryWorkout } | null = null;
  for (const sess of sessions) {
    for (const s of sess.working) {
      const kg = setKg(s);
      // equal load: more reps wins; ties keep the earliest
      if (kg !== null && (!heaviest || kg > heaviest.kg + 1e-9 || (Math.abs(kg - heaviest.kg) <= 1e-9 && (s.reps ?? 0) > (heaviest.set.reps ?? 0)))) {
        heaviest = { set: s, kg, workout: sess.workout };
      }
      const est = setE1rmKg(s);
      if (est !== null && (!best || est > best.est + 1e-9)) best = { set: s, kg: kg ?? 0, workout: sess.workout, est };
      if (s.reps !== null && (!mostReps || s.reps > (mostReps.set.reps ?? 0))) mostReps = { set: s, workout: sess.workout };
    }
  }
  if (!heaviest && !mostReps) {
    return `no ${name}${window ? ` ${window.label}` : " logged yet"}`;
  }
  const lines = [`${name} ${window ? `best ${window.label}` : "prs"}:`];
  if (heaviest) {
    const reps = heaviest.set.reps !== null ? ` × ${heaviest.set.reps}` : "";
    lines.push(`heaviest ${loadText(heaviest.set)}${reps} · ${whenText(heaviest.workout.startedLocal, ctx, false)}`);
  }
  if (best) {
    lines.push(
      `best e1rm ${amount(best.est, unit)} (${num(best.set.weight ?? 0)}×${best.set.reps}) · ${whenText(best.workout.startedLocal, ctx, false)}`,
    );
  }
  // bodyweight moves have no load to rank, so the rep record is the pr
  if (!heaviest && mostReps) {
    lines.push(`most reps ${mostReps.set.reps} · ${whenText(mostReps.workout.startedLocal, ctx, false)}`);
  }
  return withLinks(lines, heaviest?.workout ?? mostReps?.workout, best?.workout);
}

export function answerExerciseE1rm(
  exercise: Exercise,
  window: DateWindow | null,
  workouts: readonly QueryWorkout[],
  sets: readonly QuerySet[],
  ctx: AnswerContext,
): string {
  const name = lower(exercise);
  const unit = exerciseUnit(sets);
  const sessions = sessionsOf(workouts, sets)
    .filter((s) => inWindow(s.workout.startedLocal, window))
    .filter((s) => s.bestE1rmKg !== null);
  if (!sessions.length) return `no ${name} sets to estimate from${windowText(window)}`;
  const best = sessions.reduce((a, b) => (b.bestE1rmKg! > a.bestE1rmKg! + 1e-9 ? b : a));
  const last = sessions[sessions.length - 1];
  const setText = (s: Session) => `${num(s.bestE1rmSet!.weight!)}×${s.bestE1rmSet!.reps}`;
  const lines = [
    `${name} e1rm${windowText(window)}: ${amount(best.bestE1rmKg!, unit)} (${setText(best)} · ${whenText(best.workout.startedLocal, ctx, false)})`,
  ];
  if (last !== best) lines.push(`latest: ${amount(last.bestE1rmKg!, unit)} (${setText(last)} · ${whenText(last.workout.startedLocal, ctx)})`);
  return withLinks(lines, best.workout);
}

const HISTORY_SESSIONS = 8;

export function answerExerciseHistory(
  exercise: Exercise,
  window: DateWindow | null,
  workouts: readonly QueryWorkout[],
  sets: readonly QuerySet[],
  ctx: AnswerContext,
): string {
  const name = lower(exercise);
  const unit = exerciseUnit(sets);
  const sessions = sessionsOf(workouts, sets).filter((s) => inWindow(s.workout.startedLocal, window));
  if (!sessions.length) return `no ${name}${window ? ` ${window.label}` : " logged yet"}`;
  const recent = sessions.slice(-HISTORY_SESSIONS).reverse();
  const count = sessions.length > recent.length ? `last ${recent.length} of ${sessions.length} sessions` : plural(sessions.length, "session");
  const lines = [`${name} history${windowText(window)} (${count}):`, ...recent.map((s) => sessionLine(s, unit, ctx))];
  const est = sessions.filter((s) => s.bestE1rmKg !== null);
  if (est.length >= 2) {
    const first = est[0];
    const lastEst = est[est.length - 1];
    lines.push(`e1rm ${amount(first.bestE1rmKg!, unit)} → ${amount(lastEst.bestE1rmKg!, unit)} since ${whenText(first.workout.startedLocal, ctx, false)}`);
  }
  return lines.join("\n");
}

export function answerExerciseVolume(
  exercise: Exercise,
  window: DateWindow,
  workouts: readonly QueryWorkout[],
  sets: readonly QuerySet[],
): string {
  const name = lower(exercise);
  const sessions = sessionsOf(workouts, sets).filter((s) => inWindow(s.workout.startedLocal, window));
  if (!sessions.length) return `no ${name} ${window.label}`;
  const kg = sessions.reduce((t, s) => t + s.volumeKg, 0);
  const n = sessions.reduce((t, s) => t + s.working.length, 0);
  return `${name} volume ${window.label}: ${amount(kg, exerciseUnit(sets))} · ${plural(n, "set")} · ${plural(sessions.length, "session")}`;
}

export function answerExerciseCount(
  exercise: Exercise,
  window: DateWindow | null,
  workouts: readonly QueryWorkout[],
  sets: readonly QuerySet[],
): string {
  const sessions = sessionsOf(workouts, sets).filter((s) => inWindow(s.workout.startedLocal, window));
  const n = sessions.reduce((t, s) => t + s.working.length, 0);
  const when = window ? ` ${window.label}` : " all time";
  return `${lower(exercise)}: ${plural(sessions.length, "session")} · ${plural(n, "set")}${when}`;
}

// ---------------------------------------------------------------------------
// workout answers

/** a workout counts for a muscle group when the title says so or the group carries real load */
export function workoutHits(w: Pick<QueryWorkout, "title" | "muscleLoad">, subject: Subject): boolean {
  if (subject.type === "any") return true;
  if (subject.type !== "region") return false;
  const title = w.title.toLowerCase();
  const word = subject.label.split(" ")[0];
  if (new RegExp(`\\b${word}s?\\b`).test(title)) return true;
  const load = Math.max(0, ...subject.regions.map((r: MuscleRegion) => Number(w.muscleLoad?.[r]) || 0));
  return load >= 0.5;
}

function workoutLine(w: QueryWorkout, unit: WeightUnit, ctx: AnswerContext, rel = false): string {
  const parts = [whenText(w.startedLocal, ctx, rel), w.title.toLowerCase()];
  if (w.exerciseNames.length) {
    const names = w.exerciseNames.map((n) => n.toLowerCase());
    parts.push(names.length > 4 ? `${names.slice(0, 4).join(", ")} +${names.length - 4}` : names.join(", "));
  }
  parts.push(plural(w.workingSets, "set"));
  if (w.volumeKg > 0) parts.push(amount(w.volumeKg, unit));
  return parts.join(" · ");
}

function subjectNoun(subject: Subject, n: number): string {
  if (subject.type === "region") return n === 1 ? `${subject.label} day` : `${subject.label} days`;
  return n === 1 ? "workout" : "workouts";
}

export function answerWorkoutsIn(subject: Subject, window: DateWindow, workouts: readonly QueryWorkout[], ctx: AnswerContext): string {
  const hits = workouts.filter((w) => inWindow(w.startedLocal, window) && workoutHits(w, subject));
  const noun = subjectNoun(subject, hits.length);
  if (!hits.length) return `no ${noun} ${window.label}`;
  const unit = displayUnit(hits.map((w) => w.unit));
  const newest = [...hits].sort((a, b) => (a.startedLocal < b.startedLocal ? 1 : -1));
  const lines = [`${plural(hits.length, noun.replace(/s$/, ""), noun)} ${window.label}:`, ...capped(newest.map((w) => workoutLine(w, unit, ctx)))];
  return withLinks(lines, newest.length === 1 ? newest[0] : null);
}

export function answerWorkoutLast(subject: Subject, workouts: readonly QueryWorkout[], ctx: AnswerContext): string {
  const hit = [...workouts].sort((a, b) => (a.startedLocal < b.startedLocal ? 1 : -1)).find((w) => workoutHits(w, subject));
  const noun = subjectNoun(subject, 1);
  if (!hit) return `no ${noun} logged yet`;
  return withLinks([`last ${noun}: ${workoutLine(hit, displayUnit([hit.unit]), ctx, true)}`], hit);
}

export function answerWorkoutCount(subject: Subject, window: DateWindow | null, workouts: readonly QueryWorkout[]): string {
  const hits = workouts.filter((w) => inWindow(w.startedLocal, window) && workoutHits(w, subject));
  const noun = subjectNoun(subject, hits.length);
  const when = window ? window.label : "all time";
  if (!hits.length) return `0 ${subjectNoun(subject, 0)} ${when}`;
  const sets = hits.reduce((t, w) => t + w.workingSets, 0);
  const kg = hits.reduce((t, w) => t + w.volumeKg, 0);
  const parts = [`${hits.length.toLocaleString("en-US")} ${noun} ${when}`, plural(sets, "set")];
  if (kg > 0) parts.push(amount(kg, displayUnit(hits.map((w) => w.unit))));
  return parts.join(" · ");
}

export function answerWorkoutVolume(subject: Subject, window: DateWindow, workouts: readonly QueryWorkout[]): string {
  const hits = workouts.filter((w) => inWindow(w.startedLocal, window) && workoutHits(w, subject));
  const label = subject.type === "region" ? `${subject.label}-day volume` : "volume";
  if (!hits.length) return `${label} ${window.label}: nothing logged`;
  const kg = hits.reduce((t, w) => t + w.volumeKg, 0);
  const sets = hits.reduce((t, w) => t + w.workingSets, 0);
  const unit = displayUnit(hits.map((w) => w.unit));
  return `${label} ${window.label}: ${amount(kg, unit)} · ${plural(hits.length, subjectNoun(subject, 1), subjectNoun(subject, 2))} · ${plural(sets, "set")}`;
}

// ---------------------------------------------------------------------------
// help

export const QUERY_EXAMPLES = [
  "what did i bench last week",
  "squat pr",
  "e1rm bench",
  "ohp history",
  "last leg day",
  "how many workouts this month",
  "volume this week",
];

export const HELP_TEXT = [
  "share a workout to this chat to log it, or ask:",
  ...QUERY_EXAMPLES.map((q) => `· ${q}`),
  "times: today, yesterday, this/last week, this/last month, last 30 days, since oct 1, in march",
].join("\n");

export function unknownText(): string {
  return ["not sure what you're asking. try:", ...QUERY_EXAMPLES.slice(0, 5).map((q) => `· ${q}`), "or /help"].join("\n");
}

export function unknownExerciseText(term: string): string {
  return `don't know an exercise called "${term}". try a name like "bench", "squat" or "lat pulldown", or /help`;
}
