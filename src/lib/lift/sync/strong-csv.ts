import { nameKey, sha256Hex, type ParsedWorkout } from "lift-core";
import type { LiftWarning, NewLiftIngestRow } from "@/lib/db/lift-schema";
import { EDIT_OVERLAP, MAX_EXERCISES, MAX_SETS, planParsedWorkout, type IngestSummary, type WorkoutPlan } from "../plan";

// pure half of the one-time strong csv import (scripts/lift-import-strong-csv.ts).
// a csv workout is "already present" when a stored workout starts the same
// minute and has the same normalized title or mostly the same exercises, the
// same rule a re-shared (edited) workout lands by.

export const CSV_SOURCE = "strong-csv";

export interface ExistingWorkoutKey {
  title: string;
  startedLocal: string;
  id?: string;
  /** nameRaw of its exercises; without them only the title can match */
  exerciseNames?: readonly string[];
}

export type PresentReason = "title" | "exercises" | "repeat";

const displayTitle = (title: string) => title.trim() || "workout";

export function dedupeKey(title: string, startedLocal: string): string {
  return `${startedLocal.slice(0, 16)}|${nameKey(displayTitle(title))}`;
}

export function csvWorkoutId(title: string, startedLocal: string): string {
  return `strong-csv-${sha256Hex(`${nameKey(displayTitle(title))}|${startedLocal.slice(0, 16)}`).slice(0, 16)}`;
}

export function csvIngestRow(csv: string, sha: string, warnings: LiftWarning[]): NewLiftIngestRow & { id: string } {
  return {
    id: `ing_${sha.slice(0, 24)}`,
    source: CSV_SOURCE,
    rawSha256: sha,
    rawText: csv,
    strongSlug: null,
    workoutId: null,
    status: "parsed",
    // a messy export can warn on every row; the raw csv is kept for replays anyway
    warnings: warnings.slice(0, 200),
  };
}

export interface CsvPartition {
  fresh: ParsedWorkout[];
  present: ParsedWorkout[];
  /** parallel to present: why it matched and the stored workout it hit (null for a repeat inside the csv) */
  matches: { by: PresentReason; existingId: string | null }[];
  /** no date, no exercises, or too big for one batch */
  unusable: { workout: ParsedWorkout; reason: string }[];
}

interface MinuteEntry {
  id: string | null;
  titleKey: string;
  names: Set<string>;
  fromCsv: boolean;
}

function overlap(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  const size = Math.max(a.size, b.size);
  if (!size) return 0;
  let both = 0;
  for (const k of a) if (b.has(k)) both++;
  return both / size;
}

export function partitionCsvWorkouts(
  workouts: readonly ParsedWorkout[],
  existing: readonly ExistingWorkoutKey[]
): CsvPartition {
  const byMinute = new Map<string, MinuteEntry[]>();
  const add = (minute: string, e: MinuteEntry) => {
    const list = byMinute.get(minute);
    if (list) list.push(e);
    else byMinute.set(minute, [e]);
  };
  for (const e of existing) {
    add(e.startedLocal.slice(0, 16), {
      id: e.id ?? null,
      titleKey: nameKey(displayTitle(e.title)),
      names: new Set((e.exerciseNames ?? []).map(nameKey)),
      fromCsv: false,
    });
  }
  const out: CsvPartition = { fresh: [], present: [], matches: [], unusable: [] };
  for (const w of workouts) {
    const sets = w.exercises.reduce((n, e) => n + e.sets.length, 0);
    if (!w.startedLocal) out.unusable.push({ workout: w, reason: "no date" });
    else if (!w.exercises.length) out.unusable.push({ workout: w, reason: "no exercises" });
    else if (w.exercises.length > MAX_EXERCISES || sets > MAX_SETS) out.unusable.push({ workout: w, reason: "too big" });
    else {
      const minute = w.startedLocal.slice(0, 16);
      const titleKey = nameKey(displayTitle(w.title));
      const names = new Set(w.exercises.map((e) => nameKey(e.name)));
      const same = byMinute.get(minute) ?? [];
      // a title match wins over an exercise match so the reported reason is the strongest one
      const hit = same.find((e) => e.titleKey === titleKey) ?? same.find((e) => overlap(e.names, names) >= EDIT_OVERLAP);
      if (hit) {
        // a repeated row group in the csv itself counts as present too
        out.present.push(w);
        out.matches.push({ by: hit.fromCsv ? "repeat" : hit.titleKey === titleKey ? "title" : "exercises", existingId: hit.id });
      } else {
        add(minute, { id: null, titleKey, names, fromCsv: true });
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
): { plans: WorkoutPlan[]; summaries: IngestSummary[]; customIds: string[]; warnings: LiftWarning[] } {
  const warnings: LiftWarning[] = [];
  const customIds = new Set<string>();
  const summaries: IngestSummary[] = [];
  const plans = fresh.map((parsed) => {
    const { workout, summary } = planParsedWorkout(parsed, {
      workoutId: csvWorkoutId(parsed.title, parsed.startedLocal!),
      ingestId: opts.ingestId,
      workoutSource: CSV_SOURCE,
      strongSlug: null,
      timezone: opts.timezone,
      redirects: opts.redirects,
      durationS: parsed.durationS ?? null,
      warnings,
    });
    for (const e of summary.exercises) if (e.custom) customIds.add(e.exerciseId);
    summaries.push(summary);
    return workout;
  });
  return { plans, summaries, customIds: [...customIds], warnings };
}
