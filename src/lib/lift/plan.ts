import {
  computeMuscleLoad,
  e1rm,
  getExercise,
  isWorkingSet,
  parseShareText,
  resolveExerciseName,
  summarizeWorkout,
  toKg,
  type DistanceUnit,
  type Exercise,
  type ParsedSet,
  type ParsedWorkout,
  type WeightUnit,
} from "lift-core";
import type {
  LiftWarning,
  NewExerciseAliasRow,
  NewExerciseMuscleRow,
  NewExerciseRow,
  NewLiftIngestRow,
  NewLiftSetRow,
  NewLiftWorkoutExerciseRow,
  NewLiftWorkoutRow,
} from "@/lib/db/lift-schema";
import { catalogExerciseRows, customExerciseRows, nameKey, sha256Hex, type ExerciseRows } from "./rows";
import { liftTimezone, localToUtc, utcToLocal } from "./time";

// pure ingest planning: raw share text in, every row the ingest writes out.
// no db access here, so the whole mapping is unit-testable.

export type IngestSource = "shortcut" | "telegram" | "api" | "workout-csv";

export interface PlanOptions {
  source: IngestSource;
  /** used only when the share has no parseable date line */
  now?: Date;
  /** defaults to LIFT_TIMEZONE */
  timezone?: string;
  /** custom exercise id -> id it was merged into (chains already followed) */
  redirects?: ReadonlyMap<string, string>;
  /** existing workout this share rewrites (see pickEditTarget); replaces the derived id */
  workoutId?: string;
  /** warnings found before planning (e.g. by the edit lookup), stored on the ingest row */
  extraWarnings?: readonly LiftWarning[];
}

export interface ParsedWorkoutPlanOptions {
  workoutId: string;
  ingestId: string;
  /** lift_workouts.source */
  workoutSource: string;
  shareSlug: string | null;
  now?: Date;
  timezone?: string;
  redirects?: ReadonlyMap<string, string>;
  /** known workout length (csv exports have it); sets endedAt too */
  durationS?: number | null;
  /** warnings found while planning are appended here */
  warnings: LiftWarning[];
}

/** one working set as logged, for the human summary */
export interface SetBrief {
  weight: number | null;
  unit: WeightUnit | null;
  reps: number | null;
  durationS: number | null;
  distance: number | null;
  distanceUnit: DistanceUnit | null;
  bodyweight: boolean;
}

export interface ExerciseLine {
  exerciseId: string;
  name: string;
  custom: boolean;
  workingSets: number;
  volumeKg: number;
  bestE1rmKg: number | null;
  topSet: { weight: number; unit: WeightUnit; reps: number } | null;
  /** working sets in order (warm-ups left out) */
  sets: SetBrief[];
}

export interface IngestSummary {
  title: string;
  startedLocal: string;
  exerciseCount: number;
  workingSets: number;
  volumeKg: number;
  unit: WeightUnit;
  exercises: ExerciseLine[];
}

export interface WorkoutPlan {
  workout: NewLiftWorkoutRow & { id: string; startedLocal: string };
  exercises: NewExerciseRow[];
  aliases: NewExerciseAliasRow[];
  muscles: NewExerciseMuscleRow[];
  workoutExercises: NewLiftWorkoutExerciseRow[];
  sets: NewLiftSetRow[];
}

export interface IngestPlan {
  sha256: string;
  ingest: NewLiftIngestRow & { id: string };
  /** null when nothing parsed: the ingest is stored as 'empty' */
  workout: WorkoutPlan | null;
  summary: IngestSummary | null;
  parsed: ParsedWorkout;
  warnings: LiftWarning[];
  /** why a parsed share was refused (kept as an 'empty' ingest), if it was */
  rejected?: string | null;
}

const DISTANCE_TO_M: Record<DistanceUnit, number> = {
  m: 1,
  km: 1000,
  mi: 1609.344,
  ft: 0.3048,
  yd: 0.9144,
};

// link slugs become primary keys, so only accept boring ones
const SLUG_RE = /^[A-Za-z0-9_-]{1,64}$/;

function round(n: number, places = 3): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

function setRow(set: ParsedSet, id: string, workoutExerciseId: string): NewLiftSetRow {
  const weightKg = set.weight != null && set.unit ? round(toKg(set.weight, set.unit)) : null;
  // e1rm only means something for absolute loads; "+25 lb" on a pull-up is not a 1rm input
  const est =
    isWorkingSet(set) && !set.bodyweight && weightKg != null && weightKg > 0 && set.reps != null && set.reps > 0
      ? e1rm(weightKg, set.reps)
      : null;
  return {
    id,
    workoutExerciseId,
    position: set.position,
    kind: set.kind,
    weight: set.weight,
    unit: set.unit,
    weightKg,
    reps: set.reps,
    durationS: set.durationS,
    distanceM: set.distance != null && set.distanceUnit ? round(set.distance * DISTANCE_TO_M[set.distanceUnit], 2) : null,
    rpe: set.rpe,
    bodyweight: set.bodyweight,
    note: set.note,
    e1rmKg: est != null ? round(est, 2) : null,
    completed: true,
  };
}

function setBrief(s: ParsedSet): SetBrief {
  return {
    weight: s.weight,
    unit: s.unit,
    reps: s.reps,
    durationS: s.durationS,
    distance: s.distance,
    distanceUnit: s.distanceUnit,
    bodyweight: s.bodyweight,
  };
}

function joinNotes(notes: readonly string[]): string | null {
  const text = notes.map((n) => n.trim()).filter(Boolean).join("\n");
  return text || null;
}

// one batch binds every row's columns; postgres caps a statement at 65535 params
export const MAX_SETS = 500;
export const MAX_EXERCISES = 100;

function tooLarge(parsed: ParsedWorkout): string | null {
  const sets = parsed.exercises.reduce((n, e) => n + e.sets.length, 0);
  if (parsed.exercises.length > MAX_EXERCISES || sets > MAX_SETS) {
    return `too big to log: ${parsed.exercises.length} exercises / ${sets} sets (max ${MAX_EXERCISES} / ${MAX_SETS})`;
  }
  return null;
}

function derivedWorkoutId(parsed: ParsedWorkout, slug: string | null, sha256: string): string {
  if (slug) return `share-${slug}`;
  // same title + start from any channel (or with stray whitespace) is the same workout
  if (parsed.startedLocal) return `share-${sha256Hex(`${nameKey(parsed.title)}|${parsed.startedLocal}`).slice(0, 16)}`;
  return `share-${sha256.slice(0, 16)}`;
}

export function planShareIngest(rawText: string, opts: PlanOptions): IngestPlan {
  const sha256 = sha256Hex(rawText);
  const parsed = parseShareText(rawText);
  const warnings: LiftWarning[] = parsed.warnings.map((w) => ({ line: w.line, message: w.message, text: w.text }));
  if (opts.extraWarnings) warnings.push(...opts.extraWarnings);
  const slug = parsed.linkSlug && SLUG_RE.test(parsed.linkSlug) ? parsed.linkSlug : null;
  const ingestId = `ing_${sha256.slice(0, 24)}`;
  const rejected = tooLarge(parsed);
  if (rejected) warnings.push({ line: 0, message: rejected, text: "" });
  const hasWorkout = parsed.exercises.length > 0 && !rejected;
  const workoutId = opts.workoutId ?? derivedWorkoutId(parsed, slug, sha256);

  const ingest: IngestPlan["ingest"] = {
    id: ingestId,
    source: opts.source,
    rawSha256: sha256,
    rawText,
    shareSlug: slug,
    workoutId: hasWorkout ? workoutId : null,
    status: hasWorkout ? "parsed" : "empty",
    warnings,
  };
  if (!hasWorkout) return { sha256, ingest, workout: null, summary: null, parsed, warnings, rejected };

  const { workout, summary } = planParsedWorkout(parsed, {
    workoutId,
    ingestId,
    workoutSource: "share-text",
    shareSlug: slug,
    now: opts.now,
    timezone: opts.timezone,
    redirects: opts.redirects,
    warnings,
  });
  return { sha256, ingest, workout, summary, parsed, warnings, rejected: null };
}

/** every row one parsed workout writes; shared by the share-text ingest and the csv import */
export function planParsedWorkout(
  parsed: ParsedWorkout,
  opts: ParsedWorkoutPlanOptions
): { workout: WorkoutPlan; summary: IngestSummary } {
  const { workoutId, ingestId, warnings } = opts;
  const tz = opts.timezone ?? liftTimezone();
  let startedLocal = parsed.startedLocal;
  if (!startedLocal) {
    startedLocal = utcToLocal(opts.now ?? new Date(), tz);
    warnings.push({ line: 0, message: "no workout date found; using the time it was received", text: "" });
  }
  const utc = localToUtc(startedLocal, tz);
  const durationS = opts.durationS != null && opts.durationS > 0 ? Math.round(opts.durationS) : null;

  const exerciseRows = new Map<string, NewExerciseRow>();
  const aliasRows = new Map<string, NewExerciseAliasRow>();
  const muscleRows = new Map<string, NewExerciseMuscleRow>();
  const workoutExercises: NewLiftWorkoutExerciseRow[] = [];
  const sets: NewLiftSetRow[] = [];
  const loadEntries: { exercise: Exercise; workingSets: number }[] = [];
  const resolvedIds: { id: string; custom: boolean }[] = [];

  parsed.exercises.forEach((pe, i) => {
    let catalog = resolveExerciseName(pe.name);
    let rows: ExerciseRows | null = catalog ? catalogExerciseRows(catalog) : customExerciseRows(pe.name, pe.sets);
    let exId = rows.exercise.id;
    // a custom exercise merged into another one logs against the target
    const target = catalog ? undefined : opts.redirects?.get(exId);
    if (target) {
      exId = target;
      catalog = getExercise(target);
      // a custom target already exists (that's how the redirect was found)
      rows = catalog ? catalogExerciseRows(catalog) : null;
    }
    if (rows) {
      exerciseRows.set(exId, rows.exercise);
      for (const a of rows.aliases) aliasRows.set(`${a.exerciseId}\u0000${a.normalized}`, a);
      for (const m of rows.muscles) muscleRows.set(`${m.exerciseId}\u0000${m.region}`, m);
    }
    resolvedIds.push({ id: exId, custom: !catalog });

    const weId = `${workoutId}:${i}`;
    workoutExercises.push({
      id: weId,
      workoutId,
      exerciseId: exId,
      position: i,
      nameRaw: pe.name,
      notes: joinNotes(pe.notes),
      supersetGroup: null,
    });
    // ids use the array index, not the parser's position, so they stay unique
    pe.sets.forEach((s, j) => sets.push(setRow(s, `${weId}:${j}`, weId)));

    const working = pe.sets.filter((s) => isWorkingSet(s)).length;
    if (catalog && working > 0) loadEntries.push({ exercise: catalog, workingSets: working });
  });

  const totals = summarizeWorkout(parsed);
  const muscleLoad = loadEntries.length ? computeMuscleLoad(loadEntries).normalized : {};
  const normalizedLoad: Record<string, number> = {};
  for (const [region, v] of Object.entries(muscleLoad)) if (typeof v === "number") normalizedLoad[region] = round(v);

  const workout: WorkoutPlan["workout"] = {
    id: workoutId,
    title: parsed.title.trim() || "workout",
    startedLocal,
    startedAt: utc?.date ?? null,
    utcOffsetMin: utc?.utcOffsetMin ?? null,
    endedAt: utc && durationS != null ? new Date(utc.date.getTime() + durationS * 1000) : null,
    durationS,
    notes: joinNotes(parsed.notes),
    source: opts.workoutSource,
    latestIngestId: ingestId,
    shareSlug: opts.shareSlug,
    workingSets: totals.workingSets,
    volumeKg: round(totals.volumeKg, 2),
    muscleLoad: normalizedLoad,
    deletedAt: null,
  };

  const summary: IngestSummary = {
    title: workout.title,
    startedLocal,
    exerciseCount: parsed.exercises.length,
    workingSets: totals.workingSets,
    volumeKg: workout.volumeKg ?? 0,
    unit: totals.unit,
    exercises: parsed.exercises.map((pe, i) => {
      const s = totals.exercises[i];
      return {
        exerciseId: resolvedIds[i].id,
        name: pe.name,
        custom: resolvedIds[i].custom,
        workingSets: s?.workingSets ?? 0,
        volumeKg: round(s?.volumeKg ?? 0, 2),
        bestE1rmKg: s?.bestE1rmKg != null ? round(s.bestE1rmKg, 2) : null,
        topSet: s?.topSet ?? null,
        sets: pe.sets.filter((x) => isWorkingSet(x)).map(setBrief),
      };
    }),
  };

  return {
    workout: {
      workout,
      exercises: [...exerciseRows.values()],
      aliases: [...aliasRows.values()],
      muscles: [...muscleRows.values()],
      workoutExercises,
      sets,
    },
    summary,
  };
}

/** a stored workout a new share might be an edit of */
export interface EditCandidate {
  id: string;
  title: string;
  startedLocal: string;
  shareSlug: string | null;
  source: string;
  deletedAt: Date | null;
  /** nameRaw of its exercises */
  exerciseNames: readonly string[];
}

export interface EditLookup {
  /** the id the share gets on its own */
  plannedId: string;
  slug: string | null;
  title: string;
  /** the parsed start; null when the share had no date */
  startedLocal: string | null;
  exerciseNames: readonly string[];
}

export type EditTarget =
  | { kind: "new" }
  /** this share rewrites a stored workout (a deleted one comes back, so it reads as logged again) */
  | { kind: "existing"; workoutId: string; deleted: boolean }
  /** several workouts could be the one edited, so it's logged as new rather than guessed */
  | { kind: "ambiguous"; workoutIds: string[] };

// an edit keeps at least this share of the exercise names
export const EDIT_OVERLAP = 0.5;

function exerciseOverlap(a: readonly string[], b: readonly string[]): number {
  const ka = new Set(a.map(nameKey));
  const kb = new Set(b.map(nameKey));
  const size = Math.max(ka.size, kb.size);
  if (!size) return 0;
  let both = 0;
  for (const k of ka) if (kb.has(k)) both++;
  return both / size;
}

function existing(c: EditCandidate): EditTarget {
  return { kind: "existing", workoutId: c.id, deleted: c.deletedAt != null };
}

/**
 * which stored workout a share lands on. the app can issue a new link (and the
 * title can change) when a workout is edited and re-shared, so a share whose
 * own id is unknown still updates the one imported workout that started the same
 * minute with the same title or mostly the same exercises.
 */
export function pickEditTarget(share: EditLookup, candidates: readonly EditCandidate[]): EditTarget {
  const own = candidates.find((c) => c.id === share.plannedId);
  if (own) return existing(own);
  // the same link already landed on another id (an earlier edit moved it there).
  // the slug is unique on workouts, so a new row with it would fail anyway
  const sameSlug = share.slug ? candidates.find((c) => c.shareSlug === share.slug) : undefined;
  if (sameSlug) return existing(sameSlug);
  if (!share.startedLocal) return { kind: "new" };

  const title = nameKey(share.title);
  const matches = candidates.filter(
    (c) =>
      c.startedLocal === share.startedLocal &&
      c.source.startsWith("share") &&
      !c.deletedAt &&
      (nameKey(c.title) === title || exerciseOverlap(c.exerciseNames, share.exerciseNames) >= EDIT_OVERLAP)
  );
  if (matches.length === 1) return existing(matches[0]);
  if (matches.length > 1) return { kind: "ambiguous", workoutIds: matches.map((m) => m.id).sort() };
  return { kind: "new" };
}
