import { nameKey, sha256Hex, type ParsedWorkout } from "lift-core";
import type { LiftWarning, NewLiftIngestRow } from "@/lib/db/lift-schema";
import { MAX_EXERCISES, MAX_SETS, planParsedWorkout, type WorkoutPlan } from "../plan";

// pure half of the one-time workout csv import (scripts/lift-import-workout-csv.ts).
// a csv workout is "already present" when a stored workout has the same start
// minute and the same normalized title, the same key share-text ids hash.

export const CSV_SOURCE = "workout-csv";

export interface ExistingWorkoutKey {
  title: string;
  startedLocal: string;
}

const displayTitle = (title: string) => title.trim() || "workout";

export function dedupeKey(title: string, startedLocal: string): string {
  return `${startedLocal.slice(0, 16)}|${nameKey(displayTitle(title))}`;
}

export function csvWorkoutId(title: string, startedLocal: string): string {
  return `workout-csv-${sha256Hex(`${nameKey(displayTitle(title))}|${startedLocal.slice(0, 16)}`).slice(0, 16)}`;
}

export function csvIngestRow(csv: string, sha: string, warnings: LiftWarning[]): NewLiftIngestRow & { id: string } {
  return {
    id: `ing_${sha.slice(0, 24)}`,
    source: CSV_SOURCE,
    rawSha256: sha,
    rawText: csv,
    shareSlug: null,
    workoutId: null,
    status: "parsed",
    // a messy export can warn on every row; the raw csv is kept for replays anyway
    warnings: warnings.slice(0, 200),
  };
}

export interface CsvPartition {
  fresh: ParsedWorkout[];
  present: ParsedWorkout[];
  /** no date, no exercises, or too big for one batch */
  unusable: { workout: ParsedWorkout; reason: string }[];
}

export function partitionCsvWorkouts(
  workouts: readonly ParsedWorkout[],
  existing: readonly ExistingWorkoutKey[]
): CsvPartition {
  const seen = new Set(existing.map((e) => dedupeKey(e.title, e.startedLocal)));
  const out: CsvPartition = { fresh: [], present: [], unusable: [] };
  for (const w of workouts) {
    const sets = w.exercises.reduce((n, e) => n + e.sets.length, 0);
    if (!w.startedLocal) out.unusable.push({ workout: w, reason: "no date" });
    else if (!w.exercises.length) out.unusable.push({ workout: w, reason: "no exercises" });
    else if (w.exercises.length > MAX_EXERCISES || sets > MAX_SETS) out.unusable.push({ workout: w, reason: "too big" });
    else {
      const key = dedupeKey(w.title, w.startedLocal);
      // a repeated row group in the csv itself counts as present too
      if (seen.has(key)) out.present.push(w);
      else {
        seen.add(key);
        out.fresh.push(w);
      }
    }
  }
  return out;
}

export interface CsvPlanOptions {
  ingestId: string;
  timezone?: string;
  redirects?: ReadonlyMap<string, string>;
}

export function planCsvWorkouts(
  fresh: readonly ParsedWorkout[],
  opts: CsvPlanOptions
): { plans: WorkoutPlan[]; customIds: string[]; warnings: LiftWarning[] } {
  const warnings: LiftWarning[] = [];
  const customIds = new Set<string>();
  const plans = fresh.map((parsed) => {
    const { workout, summary } = planParsedWorkout(parsed, {
      workoutId: csvWorkoutId(parsed.title, parsed.startedLocal!),
      ingestId: opts.ingestId,
      workoutSource: CSV_SOURCE,
      shareSlug: null,
      timezone: opts.timezone,
      redirects: opts.redirects,
      durationS: (parsed as ParsedWorkout & { durationS?: number | null }).durationS ?? null,
      warnings,
    });
    for (const e of summary.exercises) if (e.custom) customIds.add(e.exerciseId);
    return workout;
  });
  return { plans, customIds: [...customIds], warnings };
}
