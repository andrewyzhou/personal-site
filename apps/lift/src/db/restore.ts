// reinstall restore: replace local tables with the server snapshot. rows come
// from the server, so no outbox rows are written for them.

import { count, eq, isNotNull, isNull, type SQL } from "drizzle-orm";
import type { SyncEntity } from "lift-core";
import { db } from "./client";
import { notify } from "./events";
import { clearPriorBests } from "./prs";
import {
  bodyweights,
  customExercises,
  kv,
  outbox,
  sets,
  templateExercises,
  templateFolders,
  templates,
  workoutExercises,
  workouts,
} from "./schema";
import { countRejected, countUnsynced, getServerUrl, getToken, isSyncing, recoverServerUrl } from "./sync";
import { chunk, fetchSnapshot, restoreBlocker, restorePlan, wipeOrder } from "../lib/sync/snapshot";
import { shouldOfferRestore } from "../lib/sync/restoreOffer";
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

const OFFER_DISMISSED = "restoreOfferDismissed";

/** rows across every synced table; templates or a bodyweight alone still count as data */
export function countLocalRows(): number {
  let n = 0;
  for (const t of Object.values(TABLES)) n += db.select({ n: count() }).from(t as typeof workouts).get()?.n ?? 0;
  return n;
}

export function dismissRestoreOffer(): void {
  const at = String(Date.now());
  db.insert(kv).values({ key: OFFER_DISMISSED, value: at }).onConflictDoUpdate({ target: kv.key, set: { value: at } }).run();
}

/**
 * home's one-tap restore: an empty db plus any saved token, whether it
 * survived a reinstall in the keychain or was typed into settings afterwards
 * (android and new phones; see the keychain note on getToken)
 */
export async function checkRestoreOffer(): Promise<boolean> {
  const dismissed = db.select({ value: kv.value }).from(kv).where(eq(kv.key, OFFER_DISMISSED)).get();
  const base = {
    localRows: countLocalRows(),
    pending: countUnsynced() + countRejected(),
    restoredAt: getRestoredAt(),
    dismissed: Boolean(dismissed),
  };
  // the cheap checks first, so a normal launch never touches the keychain
  if (!shouldOfferRestore({ ...base, hasToken: true })) return false;
  const hasToken = Boolean(await getToken());
  if (hasToken) await recoverServerUrl();
  return shouldOfferRestore({ ...base, hasToken });
}

export interface RestoreResult {
  workouts: number;
  sets: number;
  dropped: number;
}

export async function restoreFromServer(
  options: {
    replace?: boolean;
    /** the user agreed to lose changes the server refused */
    allowRejected?: boolean;
    fetch?: FetchLike;
  } = {}
): Promise<RestoreResult> {
  // pending (or refused) changes would be wiped before reaching the server
  // a push in flight would ack outbox rows while the tables are being replaced
  if (isSyncing()) throw new Error("sync in progress, try again in a moment");
  const blocked = restoreBlocker({ unsynced: countUnsynced(), rejected: countRejected() }, options.allowRejected);
  if (blocked) throw new Error(blocked);
  if (countLocalWorkouts() > 0 && !options.replace) throw new Error("local data exists");

  const token = (await getToken()) ?? "";
  const snapshot = await fetchSnapshot(options.fetch ?? (fetch as unknown as FetchLike), getServerUrl(), token);
  const plan = restorePlan(snapshot);

  db.transaction((tx) => {
    // re-check inside the transaction: the fetch takes a while, and a workout
    // or an edit could have landed meanwhile
    const n = (where: SQL) => tx.select({ n: count() }).from(outbox).where(where).get()?.n ?? 0;
    const again = restoreBlocker({ unsynced: n(isNull(outbox.syncedAt)), rejected: n(isNotNull(outbox.rejected)) }, options.allowRejected);
    if (again) throw new Error(again);
    if (!options.replace && (tx.select({ n: count() }).from(workouts).get()?.n ?? 0) > 0) {
      throw new Error("local data exists");
    }
    // the server copy supersedes the refused changes the user chose to drop
    if (options.allowRejected) tx.delete(outbox).where(isNotNull(outbox.rejected)).run();
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
  // every table was replaced, so cached bests are stale; clear before screens re-read
  clearPriorBests();
  notify();
  return { ...plan.counts, dropped: plan.dropped };
}
