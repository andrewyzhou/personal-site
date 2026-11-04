import { and, eq, inArray, isNull, like, or, sql, type SQL } from "drizzle-orm";
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
import {
  pickEditTarget,
  planStrongIngest,
  type EditCandidate,
  type EditLookup,
  type IngestPlan,
  type IngestSource,
  type IngestSummary,
  type PlanOptions,
  type WorkoutPlan,
} from "./plan";
import { formatIngestDetails, formatIngestSummary, type LinkedActivity } from "./summary";

/** 'updated': an edited re-share rewrote a workout that was already logged */
export type IngestStatus = "created" | "updated" | "duplicate" | "empty";

export interface IngestResult {
  status: IngestStatus;
  duplicate: boolean;
  ingestId: string;
  workoutId: string | null;
  summary: IngestSummary | null;
  /** one-line human summary (or the reason nothing was logged) */
  text: string;
  /** multi-line breakdown: the one-liner, each exercise, the watch link, warnings */
  details: string;
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

/**
 * rows that could be the workout a share edits: its own id, the same strong
 * link, or a live strong workout starting the same minute. pickEditTarget
 * re-checks every condition, so this only has to be a superset.
 */
export function editCandidatesWhere(plannedId: string, slug: string | null, startedLocal: string | null): SQL {
  const t = liftWorkouts;
  const conds: (SQL | undefined)[] = [eq(t.id, plannedId)];
  if (slug) conds.push(eq(t.strongSlug, slug));
  if (startedLocal) conds.push(and(eq(t.startedLocal, startedLocal), like(t.source, "strong%"), isNull(t.deletedAt)));
  return or(...conds)!;
}

export async function loadEditCandidates(db: Db, share: EditLookup): Promise<EditCandidate[]> {
  const rows = await db
    .select({
      id: liftWorkouts.id,
      title: liftWorkouts.title,
      startedLocal: liftWorkouts.startedLocal,
      strongSlug: liftWorkouts.strongSlug,
      source: liftWorkouts.source,
      deletedAt: liftWorkouts.deletedAt,
    })
    .from(liftWorkouts)
    .where(editCandidatesWhere(share.plannedId, share.slug, share.startedLocal));
  // names only matter for same-minute matches that aren't already decided by id or slug
  const needNames = rows.filter((r) => r.id !== share.plannedId && r.startedLocal === share.startedLocal).map((r) => r.id);
  const names = new Map<string, string[]>();
  if (needNames.length) {
    const ex = await db
      .select({ workoutId: liftWorkoutExercises.workoutId, nameRaw: liftWorkoutExercises.nameRaw })
      .from(liftWorkoutExercises)
      .where(inArray(liftWorkoutExercises.workoutId, needNames));
    for (const e of ex) {
      if (!needNames.includes(e.workoutId)) continue;
      names.set(e.workoutId, [...(names.get(e.workoutId) ?? []), e.nameRaw]);
    }
  }
  return rows.map((r) => ({ ...r, exerciseNames: names.get(r.id) ?? [] }));
}

export function ambiguousWarning(ids: readonly string[]): LiftWarning {
  return {
    line: 0,
    message: `${ids.length} workouts already start at that minute, so this was logged as a new one`,
    text: ids.join(", "),
  };
}

export async function ingestStrongText(rawText: string, opts: { source: IngestSource }): Promise<IngestResult> {
  let plan = planStrongIngest(rawText, { source: opts.source });
  const db = getDb();
  let redirects: ReadonlyMap<string, string> | undefined;
  const replan = (extra: Omit<PlanOptions, "source">) =>
    planStrongIngest(rawText, { source: opts.source, redirects, ...extra });

  // exercises merged on the phone keep resolving to the merge target
  const customIds = plan.summary?.exercises.filter((e) => e.custom).map((e) => e.exerciseId) ?? [];
  if (customIds.length) {
    const found = await loadMergeRedirects(db, customIds);
    if (found.size) {
      redirects = found;
      plan = replan({});
    }
  }

  const [existing] = await db
    .select({ id: liftIngests.id, workoutId: liftIngests.workoutId, status: liftIngests.status })
    .from(liftIngests)
    .where(eq(liftIngests.rawSha256, plan.sha256))
    .limit(1);

  let updated = false;
  if (plan.workout) {
    const plannedId = plan.workout.workout.id;
    let target: string | undefined;
    if (existing?.workoutId) {
      // the same bytes land where they did last time (an edit may have moved them)
      target = existing.workoutId;
    } else {
      const share: EditLookup = {
        plannedId,
        slug: plan.ingest.strongSlug ?? null,
        title: plan.workout.workout.title,
        startedLocal: plan.parsed?.startedLocal ?? null,
        exerciseNames: plan.workout.workoutExercises.map((we) => we.nameRaw),
      };
      const pick = pickEditTarget(share, await loadEditCandidates(db, share));
      if (pick.kind === "existing") {
        target = pick.workoutId;
        updated = !pick.deleted;
      } else if (pick.kind === "ambiguous") {
        plan = replan({ extraWarnings: [ambiguousWarning(pick.workoutIds)] });
      }
    }
    if (target && target !== plannedId) plan = replan({ workoutId: target });
  }

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
      details: plan.rejected ?? EMPTY_TEXT,
      links: [],
      warnings: plan.warnings,
    };
  }

  const workout = plan.workout.workout;
  // an old 'empty' row for this sha never logged anything, so this is new
  const duplicate = Boolean(existing?.workoutId);
  if (duplicate) updated = false;
  const status: IngestStatus = duplicate ? "duplicate" : updated ? "updated" : "created";
  const links = await safeLinks(() => linkWorkout(workout), workout.id);
  log.info("lift:ingest", `${ingestId} -> ${workout.id} (${links.length} links, ${status})`);
  const fmt = { duplicate, updated };
  return {
    status,
    duplicate,
    ingestId,
    workoutId: workout.id,
    summary: plan.summary,
    text: formatIngestSummary(plan.summary, links, fmt),
    details: formatIngestDetails(plan.summary, links, { ...fmt, workoutId: workout.id, warnings: plan.warnings }),
    links,
    warnings: plan.warnings,
  };
}
