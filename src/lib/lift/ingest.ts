import { eq, inArray, sql, type SQL } from "drizzle-orm";
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
import { linkWorkout } from "./link";
import { planStrongIngest, type IngestPlan, type IngestSource, type IngestSummary, type WorkoutPlan } from "./plan";
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

const TIMING_KEYS = {
  started_at: "startedAt",
  utc_offset_min: "utcOffsetMin",
  ended_at: "endedAt",
  duration_s: "durationS",
} as const;

// keep the current value when the workout already has watch links
function unlessLinked(col: PgColumn): Record<string, SQL> {
  const key = TIMING_KEYS[col.name as keyof typeof TIMING_KEYS];
  return {
    [key]: sql.raw(
      `case when exists (select 1 from "lift_workout_activities" a where a."workout_id" = "lift_workouts"."id") ` +
        `then "lift_workouts"."${col.name}" else excluded."${col.name}" end`
    ),
  };
}

/**
 * every write for a planned ingest, in order, for one atomic db.batch. the
 * workout is upserted and its exercises replaced wholesale (sets cascade),
 * which is how an edited re-share of the same strong link lands.
 */
export function buildIngestBatch(db: Db, plan: IngestPlan): [BatchItem<"pg">, ...BatchItem<"pg">[]] {
  const first = db.insert(liftIngests).values(plan.ingest).onConflictDoNothing();
  if (!plan.workout) return [first];
  return [first, ...buildWorkoutWrites(db, plan.workout)];
}

/** the workout half of an ingest batch (the csv import shares one ingest row across many) */
export function buildWorkoutWrites(db: Db, w: WorkoutPlan): BatchItem<"pg">[] {
  const rest: BatchItem<"pg">[] = [];
  // catalog rows ride along with each ingest so nothing depends on the seed script
  // (empty when every exercise redirected to an existing custom row)
  if (w.exercises.length) rest.push(db.insert(exercises).values(w.exercises).onConflictDoNothing());
  if (w.aliases.length) rest.push(db.insert(exerciseAliases).values(w.aliases).onConflictDoNothing());
  if (w.muscles.length) rest.push(db.insert(exerciseMuscles).values(w.muscles).onConflictDoNothing());

  const t = liftWorkouts;
  rest.push(
    db
      .insert(t)
      .values(w.workout)
      .onConflictDoUpdate({
        target: t.id,
        // once linked, linkWorkout owns the timing columns; until then an edited share's start wins
        set: {
          ...unlessLinked(t.startedAt),
          ...unlessLinked(t.utcOffsetMin),
          ...unlessLinked(t.endedAt),
          ...unlessLinked(t.durationS),
          title: excluded(t.title),
          startedLocal: excluded(t.startedLocal),
          notes: excluded(t.notes),
          source: excluded(t.source),
          latestIngestId: excluded(t.latestIngestId),
          strongSlug: excluded(t.strongSlug),
          workingSets: excluded(t.workingSets),
          volumeKg: excluded(t.volumeKg),
          muscleLoad: excluded(t.muscleLoad),
          // sharing it again is an explicit "log this", so it un-deletes. a
          // phone discard also set status, so that goes back to finished too
          deletedAt: sql`null`,
          status: sql`'finished'`,
          updatedAt: sql`now()`,
        },
      })
  );
  rest.push(db.delete(liftWorkoutExercises).where(eq(liftWorkoutExercises.workoutId, w.workout.id)));
  rest.push(db.insert(liftWorkoutExercises).values(w.workoutExercises));
  if (w.sets.length) rest.push(db.insert(liftSets).values(w.sets));
  return rest;
}

const MAX_MERGE_HOPS = 5;

/**
 * custom id -> final merge target, following mergedInto chains up to 5 hops
 * (cycles stop where they loop). `lookup` maps an id to its mergedInto.
 */
export function followMergeChains(
  ids: readonly string[],
  lookup: ReadonlyMap<string, string | null>
): Map<string, string> {
  const out = new Map<string, string>();
  for (const id of ids) {
    let cur = id;
    const seen = new Set([id]);
    for (let hop = 0; hop < MAX_MERGE_HOPS; hop++) {
      const next = lookup.get(cur);
      if (!next || seen.has(next)) break;
      seen.add(next);
      cur = next;
    }
    if (cur !== id) out.set(id, cur);
  }
  return out;
}

/** merge redirects for these custom ids, one select per hop (usually zero hops) */
export async function loadMergeRedirects(db: Db, ids: readonly string[]): Promise<Map<string, string>> {
  const lookup = new Map<string, string | null>();
  let frontier = [...new Set(ids)];
  for (let hop = 0; hop < MAX_MERGE_HOPS && frontier.length; hop++) {
    const rows = await db
      .select({ id: exercises.id, mergedInto: exercises.mergedInto })
      .from(exercises)
      .where(inArray(exercises.id, frontier));
    for (const r of rows) lookup.set(r.id, r.mergedInto);
    frontier = rows.map((r) => r.mergedInto).filter((m): m is string => !!m && !lookup.has(m));
  }
  return followMergeChains(ids, lookup);
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

export async function ingestStrongText(rawText: string, opts: { source: IngestSource }): Promise<IngestResult> {
  let plan = planStrongIngest(rawText, { source: opts.source });
  const db = getDb();

  // exercises merged on the phone keep resolving to the merge target
  const customIds = plan.summary?.exercises.filter((e) => e.custom).map((e) => e.exerciseId) ?? [];
  if (customIds.length) {
    const redirects = await loadMergeRedirects(db, customIds);
    if (redirects.size) plan = planStrongIngest(rawText, { source: opts.source, redirects });
  }

  const [existing] = await db
    .select({ id: liftIngests.id, workoutId: liftIngests.workoutId, status: liftIngests.status })
    .from(liftIngests)
    .where(eq(liftIngests.rawSha256, plan.sha256))
    .limit(1);

  // the batch is idempotent, so a seen sha still writes: that un-deletes a
  // soft-deleted workout, restores A after an edited B, and lets an old
  // 'empty' ingest log once the parser learns to read it
  await db.batch(buildIngestBatch(db, plan));
  const ingestId = existing?.id ?? plan.ingest.id;

  if (!plan.workout || !plan.summary) {
    log.warn("lift:ingest", `${ingestId}: ${plan.rejected ?? "nothing parsed"}, raw kept`);
    return {
      status: "empty",
      duplicate: Boolean(existing),
      ingestId,
      workoutId: null,
      summary: null,
      text: plan.rejected ?? EMPTY_TEXT,
      links: [],
      warnings: plan.warnings,
    };
  }

  const workout = plan.workout.workout;
  // an old 'empty' row for this sha never logged anything, so this is new
  const duplicate = Boolean(existing?.workoutId);
  const links = await safeLinks(() => linkWorkout(workout), workout.id);
  log.info("lift:ingest", `${ingestId} -> ${workout.id} (${links.length} links${duplicate ? ", re-share" : ""})`);
  return {
    status: duplicate ? "duplicate" : "created",
    duplicate,
    ingestId,
    workoutId: workout.id,
    summary: plan.summary,
    text: formatIngestSummary(plan.summary, links, { duplicate }),
    links,
    warnings: plan.warnings,
  };
}
