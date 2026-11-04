import { and, eq, inArray, isNull } from "drizzle-orm";
import type { SyncPushResponse } from "lift-core";
import { getDb } from "@/lib/db";
import {
  exercises,
  liftSets,
  liftSyncLog,
  liftTemplateFolders,
  liftTemplates,
  liftWorkoutExercises,
  liftWorkouts,
} from "@/lib/db/lift-schema";
import { log } from "@/lib/log";
import { recomputeWorkoutAggregates } from "./aggregates";
import { collectRefs, planSync, type PreparedMutation, type SyncRefs, type SyncState } from "./plan";
import { validateMutation, type EnvelopeMutation } from "./validate";

type Db = ReturnType<typeof getDb>;

// ids are validated non-empty, so "" never matches and keeps every select valid
const ids = <T>(xs: readonly T[], none: T): T[] => (xs.length ? [...xs] : [none]);

/** one round trip: every lookup the planner needs, as a batch of selects */
export async function loadSyncState(db: Db, deviceId: string, refs: SyncRefs): Promise<SyncState> {
  const [seen, workouts, wes, sets, templates, folders, exs] = await db.batch([
    db
      .select({ seq: liftSyncLog.seq })
      .from(liftSyncLog)
      // a seq the server refused isn't done: an app update may resend it to be re-evaluated
      .where(
        and(eq(liftSyncLog.deviceId, deviceId), inArray(liftSyncLog.seq, ids(refs.seqs, 0)), isNull(liftSyncLog.rejected))
      ),
    db.select({ id: liftWorkouts.id }).from(liftWorkouts).where(inArray(liftWorkouts.id, ids(refs.workoutIds, ""))),
    db
      .select({
        id: liftWorkoutExercises.id,
        workoutId: liftWorkoutExercises.workoutId,
        exerciseId: liftWorkoutExercises.exerciseId,
        tracking: exercises.tracking,
      })
      .from(liftWorkoutExercises)
      .leftJoin(exercises, eq(exercises.id, liftWorkoutExercises.exerciseId))
      .where(inArray(liftWorkoutExercises.id, ids(refs.workoutExerciseIds, ""))),
    db
      .select({ id: liftSets.id, workoutId: liftWorkoutExercises.workoutId })
      .from(liftSets)
      .innerJoin(liftWorkoutExercises, eq(liftWorkoutExercises.id, liftSets.workoutExerciseId))
      .where(inArray(liftSets.id, ids(refs.setIds, ""))),
    db.select({ id: liftTemplates.id }).from(liftTemplates).where(inArray(liftTemplates.id, ids(refs.templateIds, ""))),
    db
      .select({ id: liftTemplateFolders.id })
      .from(liftTemplateFolders)
      .where(inArray(liftTemplateFolders.id, ids(refs.folderIds, ""))),
    db
      .select({ id: exercises.id, name: exercises.name, tracking: exercises.tracking })
      .from(exercises)
      .where(inArray(exercises.id, ids(refs.exerciseIds, ""))),
  ]);
  return {
    seenSeqs: new Set(seen.map((r) => Number(r.seq))),
    workouts: new Set(workouts.map((r) => r.id)),
    workoutExercises: new Map(
      wes.map((r) => [r.id, { workoutId: r.workoutId, exerciseId: r.exerciseId, tracking: r.tracking }])
    ),
    sets: new Map(sets.map((r) => [r.id, r.workoutId])),
    templates: new Set(templates.map((r) => r.id)),
    folders: new Set(folders.map((r) => r.id)),
    exercises: new Map(exs.map((r) => [r.id, { name: r.name, tracking: r.tracking }])),
  };
}

export function prepareMutations(mutations: readonly EnvelopeMutation[]): PreparedMutation[] {
  return mutations.map((m) => ({ seq: m.seq, raw: m.raw, result: validateMutation(m.raw) }));
}

/** apply a validated envelope's mutations. throws when the write batch fails (nothing applied). */
export async function pushMutations(deviceId: string, mutations: readonly EnvelopeMutation[]): Promise<SyncPushResponse> {
  const db = getDb();
  const prepared = prepareMutations(mutations);
  if (!prepared.length) return { ok: true, appliedThrough: 0, applied: 0, skipped: 0, rejected: [] };

  const state = await loadSyncState(db, deviceId, collectRefs(prepared));
  const plan = planSync(db, deviceId, prepared, state);
  if (plan.statements.length) {
    const [first, ...rest] = plan.statements;
    // one atomic batch: a failure applies nothing and the phone retries
    await db.batch([first, ...rest]);
  }

  try {
    await recomputeWorkoutAggregates(db, plan.touchedWorkoutIds, plan.mergeTargetIds);
  } catch (error) {
    // the push itself is durable; the next touch of these workouts recomputes them
    log.error("lift:sync", `aggregate recompute failed for ${plan.touchedWorkoutIds.length} workouts`, error);
  }

  if (plan.rejected.length) {
    log.warn("lift:sync", `${deviceId}: rejected ${plan.rejected.length} (first: seq ${plan.rejected[0].seq} ${plan.rejected[0].reason})`);
  }
  return {
    ok: true,
    appliedThrough: plan.appliedThrough,
    applied: plan.applied,
    skipped: plan.skipped,
    rejected: plan.rejected,
  };
}
