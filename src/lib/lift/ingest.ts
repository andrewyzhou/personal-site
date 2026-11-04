import { eq, sql, type SQL } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { PgColumn } from "drizzle-orm/pg-core";
import {
  exerciseAliases,
  exerciseMuscles,
  exercises,
  getDb,
  liftIngests,
  liftSets,
  liftWorkoutExercises,
  liftWorkouts,
  type LiftWarning,
} from "@/lib/db";
import { log } from "@/lib/log";
import { getWorkoutLinks, linkWorkout } from "./link";
import { planShareIngest, type IngestPlan, type IngestSource, type IngestSummary } from "./plan";
import { formatIngestSummary, type LinkedActivity } from "./summary";

export type IngestStatus = "created" | "duplicate" | "empty";

export interface IngestResult {
  status: IngestStatus;
  duplicate: boolean;
  ingestId: string;
  workoutId: string | null;
  summary: IngestSummary | null;
  /** one-line human summary (or the reason nothing was logged) */
  text: string;
  links: LinkedActivity[];
  warnings: LiftWarning[];
}

export const EMPTY_TEXT = "no exercises found in that text, so nothing was logged";

type Db = ReturnType<typeof getDb>;

function excluded(col: PgColumn): SQL {
  return sql.raw(`excluded."${col.name}"`);
}

/**
 * every write for a planned ingest, in order, for one atomic db.batch. the
 * workout is upserted and its exercises replaced wholesale (sets cascade),
 * which is how an edited re-share of the same share link lands.
 */
export function buildIngestBatch(db: Db, plan: IngestPlan): [BatchItem<"pg">, ...BatchItem<"pg">[]] {
  const first = db.insert(liftIngests).values(plan.ingest).onConflictDoNothing();
  const rest: BatchItem<"pg">[] = [];
  const w = plan.workout;
  if (!w) return [first];

  // catalog rows ride along with each ingest so nothing depends on the seed script
  rest.push(db.insert(exercises).values(w.exercises).onConflictDoNothing());
  if (w.aliases.length) rest.push(db.insert(exerciseAliases).values(w.aliases).onConflictDoNothing());
  if (w.muscles.length) rest.push(db.insert(exerciseMuscles).values(w.muscles).onConflictDoNothing());

  const t = liftWorkouts;
  rest.push(
    db
      .insert(t)
      .values(w.workout)
      .onConflictDoUpdate({
        target: t.id,
        set: {
          title: excluded(t.title),
          startedLocal: excluded(t.startedLocal),
          startedAt: excluded(t.startedAt),
          utcOffsetMin: excluded(t.utcOffsetMin),
          endedAt: excluded(t.endedAt),
          durationS: excluded(t.durationS),
          notes: excluded(t.notes),
          source: excluded(t.source),
          latestIngestId: excluded(t.latestIngestId),
          shareSlug: excluded(t.shareSlug),
          workingSets: excluded(t.workingSets),
          volumeKg: excluded(t.volumeKg),
          muscleLoad: excluded(t.muscleLoad),
          // sharing it again is an explicit "log this", so it un-deletes
          deletedAt: sql`null`,
          updatedAt: sql`now()`,
        },
      })
  );
  rest.push(db.delete(liftWorkoutExercises).where(eq(liftWorkoutExercises.workoutId, w.workout.id)));
  rest.push(db.insert(liftWorkoutExercises).values(w.workoutExercises));
  if (w.sets.length) rest.push(db.insert(liftSets).values(w.sets));
  return [first, ...rest];
}

async function safeLinks(fn: () => Promise<LinkedActivity[]>, workoutId: string): Promise<LinkedActivity[]> {
  try {
    return await fn();
  } catch (error) {
    // the workout is already saved; linking retries on the daily cron
    log.error("lift:ingest", `linking ${workoutId} failed`, error);
    return [];
  }
}

export async function ingestShareText(rawText: string, opts: { source: IngestSource }): Promise<IngestResult> {
  const plan = planShareIngest(rawText, { source: opts.source });
  const db = getDb();

  const [existing] = await db
    .select({ id: liftIngests.id, workoutId: liftIngests.workoutId, status: liftIngests.status })
    .from(liftIngests)
    .where(eq(liftIngests.rawSha256, plan.sha256))
    .limit(1);

  if (existing) {
    if (!existing.workoutId || !plan.summary) {
      return {
        status: "empty",
        duplicate: true,
        ingestId: existing.id,
        workoutId: null,
        summary: null,
        text: EMPTY_TEXT,
        links: [],
        warnings: plan.warnings,
      };
    }
    const workoutId = existing.workoutId;
    const links = await safeLinks(() => getWorkoutLinks(workoutId), workoutId);
    return {
      status: "duplicate",
      duplicate: true,
      ingestId: existing.id,
      workoutId,
      summary: plan.summary,
      text: formatIngestSummary(plan.summary, links, { duplicate: true }),
      links,
      warnings: plan.warnings,
    };
  }

  await db.batch(buildIngestBatch(db, plan));

  if (!plan.workout || !plan.summary) {
    log.warn("lift:ingest", `${plan.ingest.id}: nothing parsed, raw kept`);
    return {
      status: "empty",
      duplicate: false,
      ingestId: plan.ingest.id,
      workoutId: null,
      summary: null,
      text: EMPTY_TEXT,
      links: [],
      warnings: plan.warnings,
    };
  }

  const workout = plan.workout.workout;
  const links = await safeLinks(() => linkWorkout(workout), workout.id);
  log.info("lift:ingest", `${plan.ingest.id} -> ${workout.id} (${links.length} links)`);
  return {
    status: "created",
    duplicate: false,
    ingestId: plan.ingest.id,
    workoutId: workout.id,
    summary: plan.summary,
    text: formatIngestSummary(plan.summary, links),
    links,
    warnings: plan.warnings,
  };
}
