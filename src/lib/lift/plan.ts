import {
  computeMuscleLoad,
  e1rm,
  isWorkingSet,
  parseStrongText,
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
import { catalogExerciseRows, customExerciseRows, nameKey, sha256Hex } from "./rows";
import { liftTimezone, localToUtc, utcToLocal } from "./time";

// pure ingest planning: raw share text in, every row the ingest writes out.
// no db access here, so the whole mapping is unit-testable.

export type IngestSource = "shortcut" | "telegram" | "api";

export interface PlanOptions {
  source: IngestSource;
  /** used only when the share has no parseable date line */
  now?: Date;
  /** defaults to LIFT_TIMEZONE */
  timezone?: string;
}

export interface ExerciseLine {
  exerciseId: string;
  name: string;
  custom: boolean;
  workingSets: number;
  volumeKg: number;
  bestE1rmKg: number | null;
  topSet: { weight: number; unit: WeightUnit; reps: number } | null;
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

export function planStrongIngest(rawText: string, opts: PlanOptions): IngestPlan {
  const sha256 = sha256Hex(rawText);
  const parsed = parseStrongText(rawText);
  const warnings: LiftWarning[] = parsed.warnings.map((w) => ({ line: w.line, message: w.message, text: w.text }));
  const slug = parsed.linkSlug && SLUG_RE.test(parsed.linkSlug) ? parsed.linkSlug : null;
  const ingestId = `ing_${sha256.slice(0, 24)}`;
  const rejected = tooLarge(parsed);
  if (rejected) warnings.push({ line: 0, message: rejected, text: "" });
  const hasWorkout = parsed.exercises.length > 0 && !rejected;
  const workoutId = slug
    ? `strong-${slug}`
    : parsed.startedLocal
      ? // same title + start from any channel (or with stray whitespace) is the same workout
        `strong-${sha256Hex(`${nameKey(parsed.title)}|${parsed.startedLocal}`).slice(0, 16)}`
      : `strong-${sha256.slice(0, 16)}`;

  const ingest: IngestPlan["ingest"] = {
    id: ingestId,
    source: opts.source,
    rawSha256: sha256,
    rawText,
    strongSlug: slug,
    workoutId: hasWorkout ? workoutId : null,
    status: hasWorkout ? "parsed" : "empty",
    warnings,
  };
  if (!hasWorkout) return { sha256, ingest, workout: null, summary: null, parsed, warnings, rejected };

  const tz = opts.timezone ?? liftTimezone();
  let startedLocal = parsed.startedLocal;
  if (!startedLocal) {
    startedLocal = utcToLocal(opts.now ?? new Date(), tz);
    warnings.push({ line: 0, message: "no workout date found; using the time it was received", text: "" });
  }
  const utc = localToUtc(startedLocal, tz);

  const exerciseRows = new Map<string, NewExerciseRow>();
  const aliasRows = new Map<string, NewExerciseAliasRow>();
  const muscleRows = new Map<string, NewExerciseMuscleRow>();
  const workoutExercises: NewLiftWorkoutExerciseRow[] = [];
  const sets: NewLiftSetRow[] = [];
  const loadEntries: { exercise: Exercise; workingSets: number }[] = [];
  const resolvedIds: { id: string; custom: boolean }[] = [];

  parsed.exercises.forEach((pe, i) => {
    const catalog = resolveExerciseName(pe.name);
    const rows = catalog ? catalogExerciseRows(catalog) : customExerciseRows(pe.name, pe.sets);
    const exId = rows.exercise.id;
    exerciseRows.set(exId, rows.exercise);
    for (const a of rows.aliases) aliasRows.set(`${a.exerciseId}\u0000${a.normalized}`, a);
    for (const m of rows.muscles) muscleRows.set(`${m.exerciseId}\u0000${m.region}`, m);
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
    endedAt: null,
    durationS: null,
    notes: joinNotes(parsed.notes),
    source: "strong-text",
    latestIngestId: ingestId,
    strongSlug: slug,
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
      };
    }),
  };

  return {
    sha256,
    ingest,
    workout: {
      workout,
      exercises: [...exerciseRows.values()],
      aliases: [...aliasRows.values()],
      muscles: [...muscleRows.values()],
      workoutExercises,
      sets,
    },
    summary,
    parsed,
    warnings,
    rejected: null,
  };
}
