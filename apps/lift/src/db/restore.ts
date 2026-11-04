// reinstall restore: replace local tables with the server snapshot. rows come
// from the server, so no outbox rows are written for them.

import { count, eq } from "drizzle-orm";
import type { SyncEntity } from "lift-core";
import { db } from "./client";
import { notify } from "./events";
import {
  bodyweights,
  customExercises,
  kv,
  sets,
  templateExercises,
  templateFolders,
  templates,
  workoutExercises,
  workouts,
} from "./schema";
import { countUnsynced, getServerUrl, getToken } from "./sync";
import { chunk, fetchSnapshot, restorePlan, wipeOrder } from "../lib/sync/snapshot";
import type { FetchLike } from "../lib/sync/push";

const TABLES = {
  custom_exercise: customExercises,
  template_folder: templateFolders,
  template: templates,
  template_exercise: templateExercises,
  workout: workouts,
  workout_exercise: workoutExercises,
  set: sets,
  bodyweight: bodyweights,
} as const satisfies Record<SyncEntity, unknown>;

export function countLocalWorkouts(): number {
  return db.select({ n: count() }).from(workouts).get()?.n ?? 0;
}

/** epoch ms of the last restore; read directly since "restoredAt" isn't a settings key */
export function getRestoredAt(): number | null {
  const v = db.select({ value: kv.value }).from(kv).where(eq(kv.key, "restoredAt")).get()?.value;
  return v ? Number(v) : null;
}

export interface RestoreResult {
  workouts: number;
  sets: number;
  dropped: number;
}

export async function restoreFromServer(
  options: { replace?: boolean; fetch?: FetchLike } = {}
): Promise<RestoreResult> {
  // pending changes would be wiped before reaching the server
  const unsynced = countUnsynced();
  if (unsynced > 0) throw new Error(`sync first: ${unsynced} unsynced changes`);
  if (countLocalWorkouts() > 0 && !options.replace) throw new Error("local data exists");

  const token = (await getToken()) ?? "";
  const snapshot = await fetchSnapshot(options.fetch ?? (fetch as unknown as FetchLike), getServerUrl(), token);
  const plan = restorePlan(snapshot);

  db.transaction((tx) => {
    // re-check inside the transaction: a workout could have started meanwhile
    if (!options.replace && (tx.select({ n: count() }).from(workouts).get()?.n ?? 0) > 0) {
      throw new Error("local data exists");
    }
    for (const entity of wipeOrder(plan)) tx.delete(TABLES[entity]).run();
    for (const step of plan.steps) {
      // ~15 columns per row keeps each statement well under sqlite's variable limit
      for (const rows of chunk(step.rows, 200)) {
        if (rows.length) tx.insert(TABLES[step.entity]).values(rows as never).run();
      }
    }
    const at = String(Date.now());
    tx.insert(kv).values({ key: "restoredAt", value: at }).onConflictDoUpdate({ target: kv.key, set: { value: at } }).run();
  });
  notify();
  return { ...plan.counts, dropped: plan.dropped };
}
