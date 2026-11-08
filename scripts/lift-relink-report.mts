// what the "any sport" linking rule would change for the workouts already logged.
//
//   dry run (default, read-only): npx tsx --env-file=.env.local scripts/lift-relink-report.mts [--json out.json]
//   write:                        npx tsx --env-file=.env.local scripts/lift-relink-report.mts --apply
//
// the dry run only reads lift_workouts, lift_workout_activities and activities.
// --apply links just the workouts that have no links today, through
// linkWorkout (the daily cron's path, which re-checks and inserts nothing for a
// workout that gained links meanwhile). existing links, auto or manual, are
// never rewritten: "would change" rows are a report for a human to decide.

import fs from "node:fs";
import { and, eq, gte, isNull, lte } from "drizzle-orm";
import { getDb } from "../src/lib/db";
import { activities } from "../src/lib/db/schema";
import { liftWorkoutActivities, liftWorkouts } from "../src/lib/db/lift-schema";
import { linkWorkout } from "../src/lib/lift/link";
import { formatRelinkReport, planRelink, type RelinkLink } from "../src/lib/lift/relink-plan";
import { addDays } from "../src/lib/lift/time";

const apply = process.argv.includes("--apply");
const jsonAt = process.argv.indexOf("--json");
const jsonOut = jsonAt >= 0 ? process.argv[jsonAt + 1] : undefined;

const db = getDb();
const workouts = await db
  .select({ id: liftWorkouts.id, startedLocal: liftWorkouts.startedLocal, title: liftWorkouts.title })
  .from(liftWorkouts)
  .where(isNull(liftWorkouts.deletedAt));
if (!workouts.length) {
  console.log("no workouts");
  process.exit(0);
}

const links = (
  await db
    .select({
      workoutId: liftWorkoutActivities.workoutId,
      activityId: liftWorkoutActivities.activityId,
      role: liftWorkoutActivities.role,
      method: liftWorkoutActivities.method,
    })
    .from(liftWorkoutActivities)
    .innerJoin(liftWorkouts, eq(liftWorkouts.id, liftWorkoutActivities.workoutId))
    .where(isNull(liftWorkouts.deletedAt))
).map((l) => l as RelinkLink);

const days = workouts.map((w) => w.startedLocal.slice(0, 10)).sort();
const recordings = await db
  .select({
    id: activities.id,
    sportType: activities.sportType,
    name: activities.name,
    localDate: activities.localDate,
    localTime: activities.localTime,
    elapsedS: activities.elapsedTimeS,
  })
  .from(activities)
  .where(
    and(
      gte(activities.localDate, addDays(days[0], -1)),
      lte(activities.localDate, addDays(days[days.length - 1], 1)),
      eq(activities.hidden, false),
    ),
  );

const rows = planRelink(workouts, links, recordings);
console.log(formatRelinkReport(rows, recordings));
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(rows, null, 2));

const toLink = rows.filter((r) => r.change === "new-link");
if (!apply) {
  if (toLink.length) {
    console.log(`\ndry run: nothing written. to link the ${toLink.length} unlinked workouts above:`);
    console.log("  npx tsx --env-file=.env.local scripts/lift-relink-report.mts --apply");
  }
} else {
  let linked = 0;
  for (const r of toLink) {
    const out = await linkWorkout(r.workout);
    if (out.length) linked++;
    console.log(`${r.workout.id}: ${out.length ? out.map((l) => `#${l.activityId} ${l.role}`).join(", ") : "nothing (changed meanwhile)"}`);
  }
  console.log(`linked ${linked} of ${toLink.length}`);
}
