// owner-only data export: every non-deleted workout with its exercises and sets,
// as a workout csv (round-trips through lift-core parseWorkoutCsv) or as a
// versioned json document. notes are included: the route is authenticated.

import { asc, count, eq, isNull } from "drizzle-orm";
import { exercises, getDb, liftSets, liftWorkoutExercises, liftWorkouts } from "@/lib/db";

// ---------------------------------------------------------------------------
// json shape (version 1)
//
// {
//   version: 1,
//   exportedAt: iso string,
//   timezone: the LIFT_TIMEZONE that wall-clock times are in,
//   counts: { workouts, exercises, sets },
//   workouts: [{
//     id, title,
//     startedLocal: 'YYYY-MM-DDTHH:MM' wall clock, startedAt/endedAt: iso or null,
//     durationS, notes, source, status ('active' | 'finished' | 'discarded'), templateId,
//     workingSets, volumeKg,
//     exercises: [{
//       exerciseId, name (canonical), nameRaw (as logged), position, notes, supersetGroup, restS,
//       sets: [{ position, kind ('warmup' | 'normal' | 'drop' | 'failure'), weight, unit,
//                weightKg, reps, durationS, distanceM, rpe, bodyweight, note, completed, e1rmKg }]
//     }]
//   }]
// }
// weights are as logged in `unit`; weightKg/volumeKg/e1rmKg are always kg.

export const EXPORT_VERSION = 1;
export const MAX_EXPORT_SETS = 200_000;

export interface ExportSet {
  position: number;
  kind: string;
  weight: number | null;
  unit: string | null;
  weightKg: number | null;
  reps: number | null;
  durationS: number | null;
  distanceM: number | null;
  rpe: number | null;
  bodyweight: boolean;
  note: string | null;
  completed: boolean;
  e1rmKg: number | null;
}

export interface ExportExercise {
  exerciseId: string;
  name: string;
  nameRaw: string;
  position: number;
  notes: string | null;
  supersetGroup: number | null;
  restS: number | null;
  sets: ExportSet[];
}

export interface ExportWorkout {
  id: string;
  title: string;
  startedLocal: string;
  startedAt: string | null;
  endedAt: string | null;
  durationS: number | null;
  notes: string | null;
  source: string;
  status: string;
  templateId: string | null;
  workingSets: number;
  volumeKg: number;
  exercises: ExportExercise[];
}

export interface LiftExport {
  version: typeof EXPORT_VERSION;
  exportedAt: string;
  timezone: string;
  counts: { workouts: number; exercises: number; sets: number };
  workouts: ExportWorkout[];
}

export class ExportTooLargeError extends Error {
  constructor(readonly sets: number) {
    super(`export too large: ${sets.toLocaleString("en-US")} sets (limit ${MAX_EXPORT_SETS.toLocaleString("en-US")})`);
  }
}

// ---------------------------------------------------------------------------
// assembly (pure)

export type WorkoutRowIn = Omit<ExportWorkout, "exercises" | "startedAt" | "endedAt"> & {
  startedAt: Date | null;
  endedAt: Date | null;
};
export type ExerciseRowIn = Omit<ExportExercise, "sets"> & { id: string; workoutId: string };
export type SetRowIn = ExportSet & { workoutExerciseId: string };

/** flat rows -> nested workouts, oldest first; orphans (a parent missing) are dropped */
export function assembleExport(
  workouts: readonly WorkoutRowIn[],
  exerciseRows: readonly ExerciseRowIn[],
  setRows: readonly SetRowIn[],
): ExportWorkout[] {
  const out = new Map<string, ExportWorkout>();
  for (const w of [...workouts].sort((a, b) => (a.startedLocal < b.startedLocal ? -1 : a.startedLocal > b.startedLocal ? 1 : 0))) {
    out.set(w.id, {
      ...w,
      startedAt: w.startedAt ? w.startedAt.toISOString() : null,
      endedAt: w.endedAt ? w.endedAt.toISOString() : null,
      exercises: [],
    });
  }
  const exById = new Map<string, ExportExercise>();
  for (const e of [...exerciseRows].sort((a, b) => a.position - b.position)) {
    const w = out.get(e.workoutId);
    if (!w) continue;
    const ex: ExportExercise = {
      exerciseId: e.exerciseId,
      name: e.name,
      nameRaw: e.nameRaw,
      position: e.position,
      notes: e.notes,
      supersetGroup: e.supersetGroup,
      restS: e.restS,
      sets: [],
    };
    w.exercises.push(ex);
    exById.set(e.id, ex);
  }
  for (const s of [...setRows].sort((a, b) => a.position - b.position)) {
    const ex = exById.get(s.workoutExerciseId);
    if (!ex) continue;
    ex.sets.push({
      position: s.position,
      kind: s.kind,
      weight: s.weight,
      unit: s.unit,
      weightKg: s.weightKg,
      reps: s.reps,
      durationS: s.durationS,
      distanceM: s.distanceM,
      rpe: s.rpe,
      bodyweight: s.bodyweight,
      note: s.note,
      completed: s.completed,
      e1rmKg: s.e1rmKg,
    });
  }
  return [...out.values()];
}

export function exportCounts(workouts: readonly ExportWorkout[]): LiftExport["counts"] {
  let ex = 0;
  let sets = 0;
  for (const w of workouts) {
    ex += w.exercises.length;
    for (const e of w.exercises) sets += e.sets.length;
  }
  return { workouts: workouts.length, exercises: ex, sets };
}

export function toExportJson(workouts: ExportWorkout[], exportedAt: Date, timezone: string): LiftExport {
  return { version: EXPORT_VERSION, exportedAt: exportedAt.toISOString(), timezone, counts: exportCounts(workouts), workouts };
}

// ---------------------------------------------------------------------------
// workout csv (pure)

// the export columns, plus the two unit columns its older exports carried:
// without them a kg set or a distance would silently come back as lb / miles
export const WORKOUT_CSV_HEADER = [
  "Date",
  "Workout Name",
  "Duration",
  "Exercise Name",
  "Set Order",
  "Weight",
  "Reps",
  "Distance",
  "Seconds",
  "Notes",
  "Workout Notes",
  "RPE",
  "Weight Unit",
  "Distance Unit",
];

function csvField(v: string): string {
  return /[",\r\n]|^\s|\s$/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** 'YYYY-MM-DDTHH:MM' -> 'YYYY-MM-DD HH:MM:SS' */
function csvDate(startedLocal: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(startedLocal);
  return m ? `${m[1]} ${m[2]}:00` : startedLocal;
}

/** seconds -> "1h 5m", "45m", "1h 5m 12s"; empty when unknown */
export function csvDuration(s: number | null): string {
  if (s === null || !Number.isFinite(s) || s < 0) return "";
  const t = Math.round(s);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = t % 60;
  const parts: string[] = [];
  if (h) parts.push(`${h}h`);
  if (m || (!h && !sec)) parts.push(`${m}m`);
  if (sec) parts.push(`${sec}s`);
  return parts.join(" ");
}

const numText = (n: number | null) => (n === null || !Number.isFinite(n) ? "0" : String(n));

/**
 * one row per completed set (the export has no unfinished sets), in
 * workout -> exercise -> set order. workouts with no completed sets have no
 * row to live on and are left out; the json export keeps everything.
 */
export function toWorkoutCsv(workouts: readonly ExportWorkout[]): string {
  const lines = [WORKOUT_CSV_HEADER.join(",")];
  for (const w of workouts) {
    const head = [csvDate(w.startedLocal), w.title, csvDuration(w.durationS)];
    for (const ex of w.exercises) {
      let n = 0;
      for (const s of ex.sets) {
        if (!s.completed) continue;
        const order = s.kind === "warmup" ? "W" : s.kind === "drop" ? "D" : s.kind === "failure" ? "F" : String(++n);
        const row = [
          ...head,
          ex.nameRaw || ex.name,
          order,
          // the export writes 0 for "not recorded" in its numeric columns
          numText(s.weight),
          numText(s.reps),
          numText(s.distanceM),
          numText(s.durationS),
          s.note ?? "",
          w.notes ?? "",
          s.rpe === null ? "" : String(s.rpe),
          s.weight !== null ? (s.unit ?? "") : "",
          s.distanceM !== null ? "m" : "",
        ];
        lines.push(row.map(csvField).join(","));
      }
    }
  }
  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// loading

/** every non-deleted workout, nested. throws ExportTooLargeError past MAX_EXPORT_SETS. */
export async function loadExportWorkouts(): Promise<ExportWorkout[]> {
  const db = getDb();
  const live = isNull(liftWorkouts.deletedAt);
  const [{ n }] = await db
    .select({ n: count() })
    .from(liftSets)
    .innerJoin(liftWorkoutExercises, eq(liftWorkoutExercises.id, liftSets.workoutExerciseId))
    .innerJoin(liftWorkouts, eq(liftWorkouts.id, liftWorkoutExercises.workoutId))
    .where(live);
  if (Number(n) > MAX_EXPORT_SETS) throw new ExportTooLargeError(Number(n));

  const [workouts, exerciseRows, setRows] = await Promise.all([
    db
      .select({
        id: liftWorkouts.id,
        title: liftWorkouts.title,
        startedLocal: liftWorkouts.startedLocal,
        startedAt: liftWorkouts.startedAt,
        endedAt: liftWorkouts.endedAt,
        durationS: liftWorkouts.durationS,
        notes: liftWorkouts.notes,
        source: liftWorkouts.source,
        status: liftWorkouts.status,
        templateId: liftWorkouts.templateId,
        workingSets: liftWorkouts.workingSets,
        volumeKg: liftWorkouts.volumeKg,
      })
      .from(liftWorkouts)
      .where(live)
      .orderBy(asc(liftWorkouts.startedLocal), asc(liftWorkouts.id)),
    db
      .select({
        id: liftWorkoutExercises.id,
        workoutId: liftWorkoutExercises.workoutId,
        exerciseId: liftWorkoutExercises.exerciseId,
        name: exercises.name,
        nameRaw: liftWorkoutExercises.nameRaw,
        position: liftWorkoutExercises.position,
        notes: liftWorkoutExercises.notes,
        supersetGroup: liftWorkoutExercises.supersetGroup,
        restS: liftWorkoutExercises.restS,
      })
      .from(liftWorkoutExercises)
      .innerJoin(liftWorkouts, eq(liftWorkouts.id, liftWorkoutExercises.workoutId))
      .innerJoin(exercises, eq(exercises.id, liftWorkoutExercises.exerciseId))
      .where(live),
    db
      .select({
        workoutExerciseId: liftSets.workoutExerciseId,
        position: liftSets.position,
        kind: liftSets.kind,
        weight: liftSets.weight,
        unit: liftSets.unit,
        weightKg: liftSets.weightKg,
        reps: liftSets.reps,
        durationS: liftSets.durationS,
        distanceM: liftSets.distanceM,
        rpe: liftSets.rpe,
        bodyweight: liftSets.bodyweight,
        note: liftSets.note,
        completed: liftSets.completed,
        e1rmKg: liftSets.e1rmKg,
      })
      .from(liftSets)
      .innerJoin(liftWorkoutExercises, eq(liftWorkoutExercises.id, liftSets.workoutExerciseId))
      .innerJoin(liftWorkouts, eq(liftWorkouts.id, liftWorkoutExercises.workoutId))
      .where(live),
  ]);
  return assembleExport(workouts, exerciseRows, setRows);
}
