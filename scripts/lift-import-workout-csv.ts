// one-time backfill of a workout app's "export data" csv into the lift tables.
//   dry run (default, read-only): npm run lift:import-csv -- workouts.csv [--unit lb|kg] [--json]
//   write:                        npm run lift:import-csv -- workouts.csv --unit lb --apply
// takes the .csv, the .zip the app hands out, or a folder holding one csv.
// workouts already logged (same start minute + title, or same minute + mostly
// the same exercises) are skipped, so re-running only adds what's missing.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { and, eq, gte, inArray, isNull, lte, notExists } from "drizzle-orm";
import { sha256Hex, type LinkRole, type WeightUnit } from "lift-core";
import { activities, exercises, getDb, liftIngests, liftWorkoutActivities, liftWorkoutExercises, liftWorkouts } from "../src/lib/db";
import {
  activityQueryRange,
  buildCsvReport,
  csvFromZip,
  decodeCsv,
  formatCsvReport,
  parseExport,
  type ActivityRow,
} from "../src/lib/lift/csv-report";
import { buildWorkoutWrites, loadMergeRedirects } from "../src/lib/lift/ingest";
import { linkWorkout } from "../src/lib/lift/link";
import { csvIngestRow, planCsvWorkouts, type ExistingWorkoutKey } from "../src/lib/lift/workout-csv";

const WORKOUTS_PER_BATCH = 10;
// keeps each IN (...) list well under postgres' parameter cap
const ID_CHUNK = 500;

interface Args {
  path: string;
  unit: WeightUnit | null;
  apply: boolean;
  json: boolean;
}

function usage(): never {
  console.error("usage: npm run lift:import-csv -- <workouts.csv | export.zip | folder> [--unit lb|kg] [--json] [--apply]");
  process.exit(1);
}

function parseArgs(argv: string[]): Args {
  let path: string | null = null;
  let unit: WeightUnit | null = null;
  let apply = false;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") apply = true;
    else if (a === "--json") json = true;
    else if (a === "--unit" || a.startsWith("--unit=")) {
      const u = a.includes("=") ? a.slice(7) : argv[++i];
      if (u !== "lb" && u !== "kg") usage();
      unit = u;
    } else if (a.startsWith("--")) usage();
    else if (!path) path = a;
    else usage();
  }
  if (!path) usage();
  return { path, unit, apply, json };
}

function readExport(path: string): { name: string; text: string } {
  if (statSync(path).isDirectory()) {
    const csvs = readdirSync(path).filter((f) => /\.csv$/i.test(f));
    const zips = readdirSync(path).filter((f) => /\.zip$/i.test(f));
    if (csvs.length === 1) return readExport(join(path, csvs[0]));
    if (!csvs.length && zips.length === 1) return readExport(join(path, zips[0]));
    throw new Error(`${path}: expected one .csv (or one .zip) in the folder, found ${csvs.length ? csvs.join(", ") : "none"}`);
  }
  const bytes = new Uint8Array(readFileSync(path));
  // zip magic, whatever the extension says
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const hit = csvFromZip(bytes);
    if (!hit) throw new Error(`${path}: no .csv inside the zip`);
    return { name: `${path} (${hit.name})`, text: hit.text };
  }
  return { name: path, text: decodeCsv(bytes) };
}

function chunks<T>(xs: readonly T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

type Db = ReturnType<typeof getDb>;

/** every stored workout (soft-deleted too: one deleted on purpose shouldn't come back), with names where minutes collide */
async function loadExisting(db: Db, csvMinutes: ReadonlySet<string>): Promise<ExistingWorkoutKey[]> {
  const rows = await db
    .select({ id: liftWorkouts.id, title: liftWorkouts.title, startedLocal: liftWorkouts.startedLocal })
    .from(liftWorkouts);
  const needNames = rows.filter((r) => csvMinutes.has(r.startedLocal.slice(0, 16))).map((r) => r.id);
  const names = new Map<string, string[]>();
  for (const ids of chunks(needNames, ID_CHUNK)) {
    const ex = await db
      .select({ workoutId: liftWorkoutExercises.workoutId, nameRaw: liftWorkoutExercises.nameRaw })
      .from(liftWorkoutExercises)
      .where(inArray(liftWorkoutExercises.workoutId, ids));
    for (const e of ex) names.set(e.workoutId, [...(names.get(e.workoutId) ?? []), e.nameRaw]);
  }
  return rows.map((r) => ({ ...r, exerciseNames: names.get(r.id) ?? [] }));
}

async function loadKnownExercises(db: Db, ids: readonly string[]): Promise<Set<string>> {
  const known = new Set<string>();
  for (const part of chunks(ids, ID_CHUNK)) {
    const rows = await db.select({ id: exercises.id }).from(exercises).where(inArray(exercises.id, part));
    for (const r of rows) known.add(r.id);
  }
  return known;
}

/** recordings (any sport) in the range that no live workout has claimed (one query) */
async function loadRecordings(db: Db, from: string, to: string): Promise<ActivityRow[]> {
  return db
    .select({
      id: activities.id,
      sportType: activities.sportType,
      localDate: activities.localDate,
      localTime: activities.localTime,
      elapsedS: activities.elapsedTimeS,
    })
    .from(activities)
    .where(
      and(
        gte(activities.localDate, from),
        lte(activities.localDate, to),
        eq(activities.hidden, false),
        notExists(
          db
            .select({ one: liftWorkoutActivities.activityId })
            .from(liftWorkoutActivities)
            .innerJoin(liftWorkouts, eq(liftWorkouts.id, liftWorkoutActivities.workoutId))
            .where(and(eq(liftWorkoutActivities.activityId, activities.id), isNull(liftWorkouts.deletedAt)))
        )
      )
    );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  // with --json, stdout is only the json; progress goes to stderr
  const say = args.json ? (s: string) => console.error(s) : (s: string) => console.log(s);

  const file = readExport(args.path);
  const sha = sha256Hex(file.text);
  const parsedExport = parseExport(file.text, args.unit);
  const base = { file: args.path, sha256: sha, parsedExport };

  if (!process.env.DATABASE_URL) {
    const { report } = buildCsvReport({ ...base, existing: null, activities: null });
    if (args.json) console.log(JSON.stringify({ report }, null, 2));
    else say(formatCsvReport(report));
    if (args.apply) {
      console.error("DATABASE_URL not set; can't apply");
      process.exit(1);
    }
    return;
  }

  // reads only, until --apply
  const db = getDb();
  const minutes = new Set(parsedExport.parsed.workouts.flatMap((w) => (w.startedLocal ? [w.startedLocal.slice(0, 16)] : [])));
  const existing = await loadExisting(db, minutes);
  const first = buildCsvReport({ ...base, existing, activities: null });
  const { customIds } = planCsvWorkouts(first.fresh, { ingestId: "ing_scope" });
  const redirects = customIds.length ? await loadMergeRedirects(db, customIds) : new Map<string, string>();
  const knownExerciseIds = customIds.length ? await loadKnownExercises(db, [...customIds, ...redirects.values()]) : new Set<string>();
  const span = activityQueryRange(first.fresh);
  const recordings = span ? await loadRecordings(db, span.from, span.to) : [];
  const { report, fresh } = buildCsvReport({ ...base, existing, activities: recordings, knownExerciseIds, redirects });

  if (!args.apply) {
    if (args.json) console.log(JSON.stringify({ report }, null, 2));
    else say(formatCsvReport(report));
    return;
  }
  say(formatCsvReport(report).replace(/\ndry run:[\s\S]*$/, ""));
  if (!fresh.length) {
    say("nothing new to import");
    if (args.json) console.log(JSON.stringify({ report, applied: null }, null, 2));
    return;
  }

  // same fresh list and redirects the dry run reported on
  const ingest = csvIngestRow(file.text, sha, parsedExport.parsed.warnings);
  const planned = planCsvWorkouts(fresh, { ingestId: ingest.id, redirects });

  // the raw csv is stored once; every imported workout points at it
  await db.insert(liftIngests).values(ingest).onConflictDoNothing();

  let written = 0;
  for (const chunk of chunks(planned.plans, WORKOUTS_PER_BATCH)) {
    const [head, ...rest] = chunk.flatMap((p) => buildWorkoutWrites(db, p));
    await db.batch([head, ...rest]);
    written += chunk.length;
    say(`  wrote ${written}/${planned.plans.length}`);
  }

  const roles: Record<LinkRole, number> = { primary: 0, duplicate: 0, continuation: 0, overrun: 0 };
  let linked = 0;
  let linkFailures = 0;
  for (const p of planned.plans) {
    try {
      const links = await linkWorkout(p.workout);
      if (links.length) linked++;
      for (const l of links) roles[l.role]++;
    } catch (error) {
      // the cron only relinks recent workouts, so an old one stays lift-only until linked by hand
      linkFailures++;
      console.error(`  linking ${p.workout.id} failed:`, error);
    }
  }

  const applied = {
    written,
    skippedPresent: report.present.total,
    skippedUnusable: report.unusable.length,
    linked,
    liftOnly: written - linked - linkFailures,
    linkFailures,
    links: roles,
    ingestId: ingest.id,
  };
  say("");
  say(`applied: ${written} workouts written, ${applied.skippedPresent} already logged, ${applied.skippedUnusable} unusable`);
  say(`  linked ${linked} to watch recordings (${roles.primary} primary, ${roles.duplicate} duplicate, ${roles.continuation} continuation, ${roles.overrun} overrun); ${applied.liftOnly} lift-only`);
  if (linkFailures) say(`  ${linkFailures} failed to link (see errors above)`);
  say(`  raw csv kept as ingest ${ingest.id}; re-running is safe`);
  if (args.json) console.log(JSON.stringify({ report, applied }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
