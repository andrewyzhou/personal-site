// one-time import of strong's "export data" csv into the lift tables.
//   dry run (default, read-only): npx tsx --env-file=.env.local scripts/lift-import-strong-csv.ts strong.csv [--unit lb|kg]
//   write:                        npx tsx --env-file=.env.local scripts/lift-import-strong-csv.ts strong.csv --apply
// workouts already logged from share text (same start minute + title) are
// skipped, so re-running after a partial failure only adds what's missing.
import { readFileSync } from "node:fs";
import { parseStrongCsv, sha256Hex, type WeightUnit } from "lift-core";
import { getDb, liftIngests, liftWorkouts } from "../src/lib/db";
import { buildWorkoutWrites, loadMergeRedirects } from "../src/lib/lift/ingest";
import { linkWorkout } from "../src/lib/lift/link";
import { csvIngestRow, partitionCsvWorkouts, planCsvWorkouts } from "../src/lib/lift/sync/strong-csv";

const WORKOUTS_PER_BATCH = 10;

function usage(): never {
  console.error("usage: scripts/lift-import-strong-csv.ts <path-to-csv> [--unit lb|kg] [--apply]");
  process.exit(1);
}

function parseArgs(argv: string[]): { path: string; unit: WeightUnit; apply: boolean } {
  let path: string | null = null;
  let unit: WeightUnit = "lb";
  let apply = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") apply = true;
    else if (a === "--unit") {
      const u = argv[++i];
      if (u !== "lb" && u !== "kg") usage();
      unit = u;
    } else if (a.startsWith("--")) usage();
    else if (!path) path = a;
    else usage();
  }
  if (!path) usage();
  return { path, unit, apply };
}

async function main() {
  const { path, unit, apply } = parseArgs(process.argv.slice(2));
  const csv = readFileSync(path, "utf8");
  const sha = sha256Hex(csv);
  const parsed = parseStrongCsv(csv, { weightUnit: unit });
  console.log(`csv: ${parsed.workouts.length} workouts, ${parsed.warnings.length} warnings (weights in ${unit})`);
  for (const w of parsed.warnings.slice(0, 20)) console.log(`  line ${w.line}: ${w.message}${w.text ? ` — ${w.text}` : ""}`);
  if (parsed.warnings.length > 20) console.log(`  ... ${parsed.warnings.length - 20} more`);

  if (!process.env.DATABASE_URL) {
    console.log("DATABASE_URL not set; can't check what's already logged");
    process.exit(apply ? 1 : 0);
  }
  const db = getDb();
  // soft-deleted rows count: a workout deleted on purpose shouldn't come back
  const existing = await db.select({ title: liftWorkouts.title, startedLocal: liftWorkouts.startedLocal }).from(liftWorkouts);
  const part = partitionCsvWorkouts(parsed.workouts, existing);
  console.log(`would insert: ${part.fresh.length}`);
  console.log(`already present (skipped): ${part.present.length}`);
  if (part.unusable.length) {
    console.log(`unusable (skipped): ${part.unusable.length}`);
    for (const u of part.unusable.slice(0, 10)) console.log(`  ${u.workout.title} @ ${u.workout.startedLocal ?? "?"}: ${u.reason}`);
  }
  if (part.fresh.length) {
    const first = part.fresh[0].startedLocal;
    const last = part.fresh[part.fresh.length - 1].startedLocal;
    console.log(`new range: ${first} .. ${last}`);
  }

  if (!apply) {
    console.log("dry run: nothing written (pass --apply to write)");
    return;
  }
  if (!part.fresh.length) {
    console.log("nothing new to import");
    return;
  }

  const ingest = csvIngestRow(csv, sha, parsed.warnings);
  let planned = planCsvWorkouts(part.fresh, { ingestId: ingest.id });
  // exercises merged on the phone keep resolving to the merge target
  if (planned.customIds.length) {
    const redirects = await loadMergeRedirects(db, planned.customIds);
    if (redirects.size) {
      console.log(`following ${redirects.size} merged exercises`);
      planned = planCsvWorkouts(part.fresh, { ingestId: ingest.id, redirects });
    }
  }

  // the raw csv is stored once; every imported workout points at it
  await db.insert(liftIngests).values(ingest).onConflictDoNothing();

  let written = 0;
  for (let i = 0; i < planned.plans.length; i += WORKOUTS_PER_BATCH) {
    const chunk = planned.plans.slice(i, i + WORKOUTS_PER_BATCH);
    const [first, ...rest] = chunk.flatMap((p) => buildWorkoutWrites(db, p));
    await db.batch([first, ...rest]);
    written += chunk.length;
    console.log(`  wrote ${written}/${planned.plans.length}`);
  }

  let linked = 0;
  for (const p of planned.plans) {
    try {
      const links = await linkWorkout(p.workout);
      if (links.length) linked++;
    } catch (error) {
      // linking retries on the daily cron for recent workouts only, so say so
      console.error(`  linking ${p.workout.id} failed:`, error);
    }
  }
  console.log(`applied: ${written} workouts, ${linked} linked to watch recordings`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
