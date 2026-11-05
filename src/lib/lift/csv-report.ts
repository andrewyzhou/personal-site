import { unzipSync } from "fflate";
import {
  customExerciseId,
  linkWorkoutToActivities,
  parseWorkoutCsv,
  resolveExerciseName,
  STRENGTH_SPORT_TYPES,
  type DistanceUnit,
  type LinkRole,
  type ParsedWorkout,
  type ParseWarning,
  type WorkoutCsvResult,
  type WeightUnit,
} from "lift-core";
import { partitionCsvWorkouts, planCsvWorkouts, type ExistingWorkoutKey, type PresentReason } from "./sync/workout-csv";
import { addDays } from "./time";

// pure half of the workout csv backfill report (scripts/lift-import-workout-csv.ts).
// the script does the reads; everything it prints is decided here, so the dry
// run and --apply agree on what's new and the whole thing is testable without a db.

// ---------------------------------------------------------------------------
// input files

// years of workout history is a few mb; anything near this is a zip bomb or the wrong file
export const MAX_ZIP_CSV_BYTES = 50 * 1024 * 1024;

/** the first *.csv in a zip (the export is a single csv), or null */
export function csvFromZip(bytes: Uint8Array): { name: string; text: string } | null {
  let taken = false;
  const files = unzipSync(bytes, {
    // mac zips carry __MACOSX/._ shadow copies; only the first real csv is inflated
    filter: (f) => {
      if (taken || !/\.csv$/i.test(f.name) || /(^|\/)(__MACOSX\/|\._)/.test(f.name)) return false;
      // fflate sizes its output buffer from this header field, so check it before inflating
      if (!(f.originalSize <= MAX_ZIP_CSV_BYTES)) {
        throw new Error(`${f.name} is too large to import (${Math.round(f.originalSize / 1048576)} mb, limit ${MAX_ZIP_CSV_BYTES / 1048576} mb)`);
      }
      taken = true;
      return true;
    },
  });
  const name = Object.keys(files)[0];
  return name ? { name, text: decodeCsv(files[name]) } : null;
}

/** utf-8, or utf-16 when the bytes say so (some spreadsheet re-saves do) */
export function decodeCsv(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes);
  return new TextDecoder("utf-8").decode(bytes);
}

// ---------------------------------------------------------------------------
// header + unit detection

export interface HeaderFix {
  /** the csv with unit-suffixed headers renamed to what the parser reads */
  text: string;
  weightUnit: WeightUnit | null;
  distanceUnit: DistanceUnit | null;
  renamed: string[];
}

const WEIGHT_SUFFIX: Record<string, WeightUnit> = { kg: "kg", kgs: "kg", lb: "lb", lbs: "lb" };
const DISTANCE_SUFFIX: Record<string, DistanceUnit> = {
  km: "km",
  kilometers: "km",
  mi: "mi",
  miles: "mi",
  m: "m",
  meters: "m",
  metres: "m",
  ft: "ft",
  feet: "ft",
  yd: "yd",
  yards: "yd",
};

/**
 * newer exports put the unit in the header ("Weight (kg)", "Distance (meters)",
 * "Duration (sec)"). the parser only knows the bare names, and an unknown
 * weight column would silently turn every set into bodyweight, so rename them
 * and keep the unit. only the header line changes, so line numbers hold.
 */
export function fixExportHeader(csv: string): HeaderFix {
  const bom = csv.startsWith("﻿") ? "﻿" : "";
  const body = csv.slice(bom.length);
  const start = body.search(/\S/);
  if (start < 0) return { text: csv, weightUnit: null, distanceUnit: null, renamed: [] };
  const lineEnd = body.slice(start).search(/\r|\n/);
  const end = lineEnd < 0 ? body.length : start + lineEnd;
  const line = body.slice(start, end);
  const delim = [";", "\t"].reduce((best, d) => (line.split(d).length > line.split(best).length ? d : best), ",");

  let weightUnit: WeightUnit | null = null;
  let distanceUnit: DistanceUnit | null = null;
  const renamed: string[] = [];
  const fields = line.split(delim).map((raw) => {
    const f = raw.trim().replace(/^"(.*)"$/, "$1");
    const m = /^(weight|distance|duration|seconds)\s*\(\s*([a-z]+)\s*\)$/i.exec(f);
    if (!m) return raw;
    const col = m[1].toLowerCase();
    const unit = m[2].toLowerCase();
    if (col === "weight" && WEIGHT_SUFFIX[unit]) weightUnit = WEIGHT_SUFFIX[unit];
    else if (col === "distance" && DISTANCE_SUFFIX[unit]) distanceUnit = DISTANCE_SUFFIX[unit];
    else if ((col === "duration" || col === "seconds") && /^s(ec|econds?)?$/.test(unit)) {
      // bare seconds already parse as seconds
    } else return raw;
    renamed.push(f);
    return col === "weight" ? "Weight" : col === "distance" ? "Distance" : col === "duration" ? "Duration" : "Seconds";
  });
  if (!renamed.length) return { text: csv, weightUnit: null, distanceUnit: null, renamed };
  return { text: bom + body.slice(0, start) + fields.join(delim) + body.slice(end), weightUnit, distanceUnit, renamed };
}

/** non-blank records after the header, quote-aware (notes can hold line breaks) */
export function countDataRows(csv: string): number {
  let records = 0;
  let quoted = false;
  let content = false;
  const text = csv.replace(/^﻿/, "");
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') quoted = !quoted;
    if (!quoted && (ch === "\n" || ch === "\r")) {
      if (content) records++;
      content = false;
    } else if (!/[\s,;"]/.test(ch)) content = true;
  }
  if (content) records++;
  return Math.max(0, records - 1);
}

export type UnitSource = "flag" | "header" | "column" | "default";

export interface UnitInfo {
  unit: WeightUnit;
  source: UnitSource;
  /** weighted sets per unit as parsed */
  sets: Record<WeightUnit, number>;
  note: string | null;
}

export interface ParsedExport {
  parsed: WorkoutCsvResult;
  rows: number;
  unit: UnitInfo;
  distanceUnit: DistanceUnit;
  renamedHeaders: string[];
}

function weightedUnits(r: WorkoutCsvResult): WeightUnit[] {
  return r.workouts.flatMap((w) => w.exercises.flatMap((e) => e.sets.flatMap((s) => (s.weight != null && s.unit ? [s.unit] : []))));
}

/**
 * parse an export, working out what unit the weights are in: a --unit flag
 * wins, then a "Weight (kg)" header, then a per-row "Weight Unit" column
 * (found by parsing both ways: if the default never mattered, the column
 * decided every row), else lb.
 */
export function parseExport(csv: string, flagUnit?: WeightUnit | null): ParsedExport {
  const fix = fixExportHeader(csv);
  const distanceUnit: DistanceUnit = fix.distanceUnit ?? "mi";
  // the parser's default distance unit only takes mi/km; others are patched after
  const parserDistance = distanceUnit === "km" ? "km" : "mi";
  const parse = (unit: WeightUnit) => {
    const r = parseWorkoutCsv(fix.text, { weightUnit: unit, distanceUnit: parserDistance });
    if (fix.distanceUnit && fix.distanceUnit !== parserDistance) {
      for (const w of r.workouts)
        for (const e of w.exercises) for (const s of e.sets) if (s.distance != null) s.distanceUnit = fix.distanceUnit;
    }
    return r;
  };

  const asLb = parse("lb");
  const asKg = parse("kg");
  const lbUnits = weightedUnits(asLb);
  const kgUnits = weightedUnits(asKg);
  const columnDecides = lbUnits.length > 0 && lbUnits.every((u, i) => u === kgUnits[i]);
  const counts = (us: WeightUnit[]) => ({ lb: us.filter((u) => u === "lb").length, kg: us.filter((u) => u === "kg").length });

  let unit: WeightUnit;
  let source: UnitSource;
  let note: string | null = null;
  if (columnDecides) {
    const c = counts(lbUnits);
    unit = c.kg > c.lb ? "kg" : "lb";
    source = "column";
    if (flagUnit && flagUnit !== unit) note = `--unit ${flagUnit} ignored: every row names its own unit`;
    if (c.kg && c.lb) note = `${note ? `${note}; ` : ""}mixed units (${c.lb} lb / ${c.kg} kg sets), each kept as logged`;
  } else if (flagUnit) {
    unit = flagUnit;
    source = "flag";
    if (fix.weightUnit && fix.weightUnit !== flagUnit) note = `header says ${fix.weightUnit}, --unit ${flagUnit} wins`;
  } else if (fix.weightUnit) {
    unit = fix.weightUnit;
    source = "header";
  } else {
    unit = "lb";
    source = "default";
    if (lbUnits.length) note = "the export doesn't say; assumed lb. pass --unit kg if the app is set to kg";
  }
  // when the column decided, both parses are the same
  const parsed = columnDecides || unit === "lb" ? asLb : asKg;
  return {
    parsed,
    rows: countDataRows(csv),
    unit: { unit, source, sets: counts(weightedUnits(parsed)), note },
    distanceUnit,
    renamedHeaders: fix.renamed,
  };
}

// ---------------------------------------------------------------------------
// report

/** a watch recording as the read-only activities query returns it */
export interface ActivityRow {
  id: number;
  sportType: string;
  localDate: string;
  localTime: string;
  elapsedS: number;
}

export interface ExerciseUse {
  id: string;
  name: string;
  workouts: number;
  sets: number;
}

export interface CsvReport {
  file: string;
  sha256: string;
  rows: number;
  unit: UnitInfo;
  distanceUnit: DistanceUnit;
  renamedHeaders: string[];
  workoutsParsed: number;
  dateRange: { first: string; last: string } | null;
  /** false when DATABASE_URL was missing: everything parsed counts as new */
  dbChecked: boolean;
  present: { total: number; byTitle: number; byExercises: number; repeatedInCsv: number; sample: string[] };
  unusable: { title: string; startedLocal: string | null; reason: string }[];
  fresh: { workouts: number; sets: number; workingSets: number; dateRange: { first: string; last: string } | null };
  exercises: {
    distinct: number;
    catalog: number;
    /** custom names not in the exercises table yet: the import creates them */
    newCustom: ExerciseUse[];
    existingCustom: ExerciseUse[];
    merged: { name: string; into: string }[];
    /** false when the exercises table wasn't read */
    checked: boolean;
  };
  linking: {
    checked: boolean;
    recordings: number;
    linkedWorkouts: number;
    liftOnly: number;
    /** workouts by their anchoring link */
    anchoredBy: { primary: number; overrun: number };
    /** link rows by role (a workout can have several) */
    links: Record<LinkRole, number>;
  };
  warnings: { total: number; first: { line: number; message: string; text: string }[] };
  nextCommand: string | null;
}

export interface CsvReportInput {
  /** path as given, for the next command */
  file: string;
  sha256: string;
  parsedExport: ParsedExport;
  /** stored workouts (soft-deleted ones too); null when the db wasn't read */
  existing: readonly ExistingWorkoutKey[] | null;
  /** unclaimed strength recordings over the csv's range; null when not read */
  activities: readonly ActivityRow[] | null;
  /** custom exercise ids already in the exercises table; null when not read */
  knownExerciseIds?: ReadonlySet<string> | null;
  /** custom id -> merge target */
  redirects?: ReadonlyMap<string, string>;
  timezone?: string;
  /** "npm run lift:import-csv --" by default */
  command?: string;
}

const range = (ws: readonly ParsedWorkout[]) => {
  const dates = ws.map((w) => w.startedLocal).filter((d): d is string => !!d).sort();
  return dates.length ? { first: dates[0], last: dates[dates.length - 1] } : null;
};

/** the date span (+-1 day) the activities query should cover, from the workouts that will be imported */
export function activityQueryRange(fresh: readonly ParsedWorkout[]): { from: string; to: string } | null {
  const r = range(fresh);
  return r ? { from: addDays(r.first.slice(0, 10), -1), to: addDays(r.last.slice(0, 10), 1) } : null;
}

function quoteArg(s: string): string {
  return /^[\w./:\\-]+$/.test(s) ? s : `"${s.replace(/"/g, '\\"')}"`;
}

export function applyCommand(file: string, unit: WeightUnit, command = "npm run lift:import-csv --"): string {
  return `${command} ${quoteArg(file)} --unit ${unit} --apply`;
}

/** what linkWorkout would attach, run in import order so one recording is never claimed twice */
export function simulateLinks(
  fresh: readonly ParsedWorkout[],
  recordings: readonly ActivityRow[]
): { roles: LinkRole[] }[] {
  const claimed = new Set<number>();
  return fresh.map((w) => {
    if (!w.startedLocal) return { roles: [] };
    const day = w.startedLocal.slice(0, 10);
    const [from, to] = [addDays(day, -1), addDays(day, 1)];
    // same window as candidateRecordingsQuery
    const candidates = recordings
      .filter((a) => !claimed.has(a.id) && a.localDate >= from && a.localDate <= to)
      .map((a) => ({ id: a.id, sportType: a.sportType, localStart: `${a.localDate}T${a.localTime}`, elapsedS: a.elapsedS }));
    const links = linkWorkoutToActivities(w.startedLocal, candidates);
    for (const l of links) claimed.add(l.activityId);
    return { roles: links.map((l) => l.role) };
  });
}

export function buildCsvReport(input: CsvReportInput): { report: CsvReport; fresh: ParsedWorkout[] } {
  const { parsed, unit } = input.parsedExport;
  const part = partitionCsvWorkouts(parsed.workouts, input.existing ?? []);
  const by = (r: PresentReason) => part.matches.filter((m) => m.by === r).length;
  const { summaries } = planCsvWorkouts(part.fresh, {
    ingestId: `ing_${input.sha256.slice(0, 24)}`,
    timezone: input.timezone,
    redirects: input.redirects,
  });

  // exercise usage across the workouts that would be written
  const uses = new Map<string, ExerciseUse & { custom: boolean; seenIn: number }>();
  const merged = new Map<string, string>();
  let sets = 0;
  let workingSets = 0;
  part.fresh.forEach((w, wi) => {
    const s = summaries[wi];
    workingSets += s.workingSets;
    s.exercises.forEach((line, ei) => {
      const n = w.exercises[ei].sets.length;
      sets += n;
      const own = resolveExerciseName(line.name)?.id ?? customExerciseId(line.name);
      if (own !== line.exerciseId) merged.set(line.name, line.exerciseId);
      let u = uses.get(line.exerciseId);
      if (!u) {
        u = { id: line.exerciseId, name: line.name, workouts: 0, sets: 0, custom: line.custom, seenIn: -1 };
        uses.set(line.exerciseId, u);
      }
      u.sets += n;
      if (u.seenIn !== wi) {
        u.seenIn = wi;
        u.workouts++;
      }
    });
  });
  const strip = ({ id, name, workouts, sets: n }: ExerciseUse): ExerciseUse => ({ id, name, workouts, sets: n });
  const customs = [...uses.values()].filter((u) => u.custom).sort((a, b) => b.sets - a.sets || a.name.localeCompare(b.name));
  const known = input.knownExerciseIds ?? null;
  const isKnown = (u: ExerciseUse) => known?.has(u.id) || [...merged.values()].includes(u.id);

  // linking: one read of the recordings, then the pure linker per workout
  const linking: CsvReport["linking"] = {
    checked: input.activities != null,
    recordings: input.activities?.filter((a) => STRENGTH_SPORT_TYPES.includes(a.sportType)).length ?? 0,
    linkedWorkouts: 0,
    liftOnly: part.fresh.length,
    anchoredBy: { primary: 0, overrun: 0 },
    links: { primary: 0, duplicate: 0, continuation: 0, overrun: 0 },
  };
  if (input.activities) {
    linking.liftOnly = 0;
    for (const { roles } of simulateLinks(part.fresh, input.activities)) {
      if (!roles.length) {
        linking.liftOnly++;
        continue;
      }
      linking.linkedWorkouts++;
      if (roles.includes("primary")) linking.anchoredBy.primary++;
      else linking.anchoredBy.overrun++;
      for (const r of roles) linking.links[r]++;
    }
  }

  const warnings: ParseWarning[] = parsed.warnings;
  const report: CsvReport = {
    file: input.file,
    sha256: input.sha256,
    rows: input.parsedExport.rows,
    unit,
    distanceUnit: input.parsedExport.distanceUnit,
    renamedHeaders: input.parsedExport.renamedHeaders,
    workoutsParsed: parsed.workouts.length,
    dateRange: range(parsed.workouts),
    dbChecked: input.existing != null,
    present: {
      total: part.present.length,
      byTitle: by("title"),
      byExercises: by("exercises"),
      repeatedInCsv: by("repeat"),
      sample: part.present.slice(0, 5).map((w, i) => `${w.startedLocal} ${w.title || "workout"} (${part.matches[i].by})`),
    },
    unusable: part.unusable.map((u) => ({ title: u.workout.title, startedLocal: u.workout.startedLocal, reason: u.reason })),
    fresh: { workouts: part.fresh.length, sets, workingSets, dateRange: range(part.fresh) },
    exercises: {
      distinct: uses.size,
      catalog: [...uses.values()].filter((u) => !u.custom).length,
      newCustom: customs.filter((u) => !isKnown(u)).map(strip),
      existingCustom: customs.filter((u) => isKnown(u)).map(strip),
      merged: [...merged].map(([name, into]) => ({ name, into })),
      checked: known != null,
    },
    linking,
    warnings: {
      total: warnings.length,
      first: warnings.slice(0, 10).map((w) => ({ line: w.line, message: w.message, text: w.text })),
    },
    nextCommand: part.fresh.length ? applyCommand(input.file, unit.unit, input.command) : null,
  };
  return { report, fresh: part.fresh };
}

// ---------------------------------------------------------------------------
// text

const short = (s: string, n = 80) => {
  const one = s.replace(/\r?\n/g, "\\n");
  return one.length > n ? `${one.slice(0, n - 3)}...` : one;
};
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const span = (r: { first: string; last: string } | null) => (r ? `${r.first} .. ${r.last}` : "none");

export function formatCsvReport(r: CsvReport): string {
  const out: string[] = [];
  const p = (s = "") => out.push(s);
  const unitWhy: Record<UnitSource, string> = {
    flag: "from --unit",
    header: "from the weight column header",
    column: "from the Weight Unit column",
    default: "default",
  };

  p(`workout csv: ${r.file}`);
  p(`  rows:        ${r.rows}`);
  p(`  workouts:    ${r.workoutsParsed} (${span(r.dateRange)})`);
  p(`  weights:     ${r.unit.unit} (${unitWhy[r.unit.source]})${r.unit.note ? ` - ${r.unit.note}` : ""}`);
  if (r.renamedHeaders.length) p(`  headers:     read ${r.renamedHeaders.join(", ")}`);
  p();

  if (!r.dbChecked) p("DATABASE_URL not set: nothing compared against what's logged, so all of it counts as new");
  p(`already logged (would skip): ${r.present.total}`);
  if (r.present.total) {
    const parts = [
      r.present.byTitle && `${r.present.byTitle} same minute + title`,
      r.present.byExercises && `${r.present.byExercises} same minute + mostly the same exercises`,
      r.present.repeatedInCsv && `${r.present.repeatedInCsv} repeated inside the csv`,
    ].filter(Boolean);
    p(`  ${parts.join(", ")}`);
    for (const s of r.present.sample) p(`  e.g. ${s}`);
  }
  if (r.unusable.length) {
    p(`can't import (would skip): ${r.unusable.length}`);
    for (const u of r.unusable.slice(0, 10)) p(`  ${u.title || "workout"} @ ${u.startedLocal ?? "?"}: ${u.reason}`);
  }
  p(`new workouts: ${r.fresh.workouts} (${span(r.fresh.dateRange)}), ${plural(r.fresh.sets, "set")}, ${r.fresh.workingSets} working`);
  p();

  const e = r.exercises;
  p(`exercises in new workouts: ${e.distinct} (${e.catalog} catalog, ${e.newCustom.length + e.existingCustom.length} custom)`);
  if (e.newCustom.length) {
    p(`  new custom exercises${e.checked ? "" : " (exercises table not read)"}:`);
    for (const u of e.newCustom) p(`    ${u.name} - ${plural(u.workouts, "workout")}, ${plural(u.sets, "set")}`);
  }
  if (e.existingCustom.length) {
    p("  custom exercises already known:");
    for (const u of e.existingCustom) p(`    ${u.name} - ${plural(u.workouts, "workout")}, ${plural(u.sets, "set")}`);
  }
  for (const m of e.merged) p(`  ${m.name} -> ${m.into} (merged on the phone)`);
  p();

  const l = r.linking;
  if (!l.checked) p("watch recordings: not checked");
  else {
    p(`watch recordings: ${l.recordings} unclaimed strength recordings in range`);
    p(`  would link:  ${l.linkedWorkouts} workouts (${l.anchoredBy.primary} by start time, ${l.anchoredBy.overrun} inside a long recording)`);
    p(`  link rows:   ${l.links.primary} primary, ${l.links.duplicate} duplicate, ${l.links.continuation} continuation, ${l.links.overrun} overrun`);
    p(`  lift-only:   ${l.liftOnly} workouts`);
  }
  p();

  p(`warnings: ${r.warnings.total}`);
  for (const w of r.warnings.first) p(`  line ${w.line}: ${w.message}${w.text ? ` - ${short(w.text)}` : ""}`);
  if (r.warnings.total > r.warnings.first.length) p(`  ... ${r.warnings.total - r.warnings.first.length} more`);
  p();

  if (r.nextCommand) {
    p("dry run: nothing written. to import, run:");
    p(`  ${r.nextCommand}`);
  } else p("dry run: nothing new to import");
  return out.join("\n");
}
