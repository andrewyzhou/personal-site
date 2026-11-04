// seed the built-in exercise catalog into postgres.
//   dry run (default, read-only): npx tsx --env-file=.env.local scripts/lift-seed-exercises.ts
//   write:                        npx tsx --env-file=.env.local scripts/lift-seed-exercises.ts --apply
// ingest already upserts the catalog rows it references, so this is only for
// browsing/search over the full catalog. custom rows are never touched.
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq, sql } from "drizzle-orm";
import { EXERCISES } from "lift-core";
import { exerciseAliases, exerciseMuscles, exercises } from "../src/lib/db/lift-schema";
import { catalogExerciseRows } from "../src/lib/lift/rows";

const apply = process.argv.includes("--apply");
const CHUNK = 200;

function chunks<T>(items: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// postgres "undefined_table"; neon surfaces it as .code (sometimes on .cause)
function isMissingRelation(error: unknown): boolean {
  const e = error as { code?: string; cause?: { code?: string }; message?: string };
  return e?.code === "42P01" || e?.cause?.code === "42P01" || /does not exist/i.test(e?.message ?? "");
}

async function main() {
  const rows = EXERCISES.map(catalogExerciseRows);
  const exerciseRows = rows.map((r) => r.exercise);
  const aliasRows = rows.flatMap((r) => r.aliases);
  const muscleRows = rows.flatMap((r) => r.muscles);
  console.log(
    `catalog: ${exerciseRows.length} exercises, ${aliasRows.length} aliases, ${muscleRows.length} muscle rows`
  );

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log("DATABASE_URL not set; nothing to compare against");
    if (apply) process.exit(1);
    return;
  }
  const db = drizzle(neon(url));

  let existingExercises: { id: string; source: string }[];
  let existingAliases: { exerciseId: string; normalized: string }[];
  let existingMuscles: { exerciseId: string; region: string }[];
  try {
    existingExercises = await db.select({ id: exercises.id, source: exercises.source }).from(exercises);
    existingAliases = await db
      .select({ exerciseId: exerciseAliases.exerciseId, normalized: exerciseAliases.normalized })
      .from(exerciseAliases);
    existingMuscles = await db
      .select({ exerciseId: exerciseMuscles.exerciseId, region: exerciseMuscles.region })
      .from(exerciseMuscles);
  } catch (error) {
    if (!isMissingRelation(error)) throw error;
    console.log("lift tables don't exist yet (no migration applied). would insert everything:");
    console.log(`  exercises: ${exerciseRows.length}`);
    console.log(`  aliases:   ${aliasRows.length}`);
    console.log(`  muscles:   ${muscleRows.length}`);
    if (apply) {
      console.log("--apply needs the tables; run the migration first");
      process.exit(1);
    }
    return;
  }

  const exSource = new Map(existingExercises.map((e) => [e.id, e.source]));
  const aliasKeys = new Set(existingAliases.map((a) => `${a.exerciseId}\u0000${a.normalized}`));
  const muscleKeys = new Set(existingMuscles.map((m) => `${m.exerciseId}\u0000${m.region}`));

  const newExercises = exerciseRows.filter((e) => !exSource.has(e.id));
  const updatedExercises = exerciseRows.filter((e) => exSource.get(e.id) === "catalog");
  // a non-catalog row squatting on a catalog id is left exactly as is
  const skipped = exerciseRows.filter((e) => exSource.has(e.id) && exSource.get(e.id) !== "catalog");
  const newAliases = aliasRows.filter((a) => !aliasKeys.has(`${a.exerciseId}\u0000${a.normalized}`));
  const newMuscles = muscleRows.filter((m) => !muscleKeys.has(`${m.exerciseId}\u0000${m.region}`));

  console.log(`exercises: ${newExercises.length} new, ${updatedExercises.length} catalog rows refreshed, ${skipped.length} skipped (non-catalog)`);
  console.log(`aliases:   ${newAliases.length} new`);
  console.log(`muscles:   ${newMuscles.length} new`);

  if (!apply) {
    console.log("dry run: nothing written (pass --apply to write)");
    return;
  }

  for (const part of chunks(exerciseRows)) {
    await db
      .insert(exercises)
      .values(part)
      .onConflictDoUpdate({
        target: exercises.id,
        set: {
          name: sql`excluded.name`,
          equipment: sql`excluded.equipment`,
          category: sql`excluded.category`,
          tracking: sql`excluded.tracking`,
          freeDbId: sql`excluded.free_db_id`,
          updatedAt: sql`now()`,
        },
        // only refresh rows the catalog owns; custom/app rows keep their edits
        setWhere: eq(exercises.source, "catalog"),
      });
  }
  for (const part of chunks(newAliases)) await db.insert(exerciseAliases).values(part).onConflictDoNothing();
  for (const part of chunks(newMuscles)) await db.insert(exerciseMuscles).values(part).onConflictDoNothing();
  console.log("applied");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
