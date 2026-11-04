// push-only sync client: outbox -> POST /api/lift/sync. the app token lives in
// the keychain only; server url, device id and the last result live in kv.

import { useEffect } from "react";
import { AppState } from "react-native";
import { and, asc, count, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { randomUUID } from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { db } from "./client";
import { subscribe } from "./events";
import { getSetting, setSetting } from "./settings";
import { kv, outbox, workouts } from "./schema";
import { backoffDelay } from "../lib/sync/backoff";
import { isRetryableRejection, type AckPlan, type OutboxLike } from "../lib/sync/mutations";
import { chunk } from "../lib/sync/snapshot";
import { pushAll, type FetchLike, type PushErrorKind, type PushResult } from "../lib/sync/push";
import { singleFlight } from "../lib/sync/singleFlight";

export const DEFAULT_SERVER_URL = "https://www.andrewzhou.org";
const TOKEN_KEY = "lift.appToken";
// mirrored from kv: kv is wiped by a reinstall, the keychain isn't
const URL_KEY = "lift.serverUrl";
const AUTO_INTERVAL_MS = 5 * 60_000;

export function getServerUrl(): string {
  return getSetting("serverUrl") || DEFAULT_SERVER_URL;
}

export function setServerUrl(url: string): void {
  const u = url.trim();
  setSetting("serverUrl", u);
  void (u ? SecureStore.setItemAsync(URL_KEY, u) : SecureStore.deleteItemAsync(URL_KEY)).catch(() => {});
}

/** after a reinstall: put the keychain copy of the server url back into kv */
export async function recoverServerUrl(): Promise<void> {
  if (getSetting("serverUrl")) return;
  const saved = await SecureStore.getItemAsync(URL_KEY);
  if (saved) setSetting("serverUrl", saved);
}

export async function getToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function setToken(token: string): Promise<void> {
  const t = token.trim();
  if (t) await SecureStore.setItemAsync(TOKEN_KEY, t);
  else await SecureStore.deleteItemAsync(TOKEN_KEY);
}

/** generated once per install; the server keys seqs by it */
export function getDeviceId(): string {
  const existing = getSetting("deviceId");
  if (existing) return existing;
  const id = randomUUID();
  setSetting("deviceId", id);
  return id;
}

export interface SyncStatus {
  at: number;
  ok: boolean;
  message: string;
  /** failure class (unauthorized, bad_request, too_large, ...); absent on success */
  kind?: PushErrorKind;
}

export function getLastSync(): SyncStatus | null {
  const raw = getSetting("lastSyncResult");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SyncStatus;
  } catch {
    return null;
  }
}

export function countUnsynced(): number {
  return db.select({ n: count() }).from(outbox).where(isNull(outbox.syncedAt)).get()?.n ?? 0;
}

/** changes the server refused: marked synced, but they never reached it */
export function countRejected(): number {
  return db.select({ n: count() }).from(outbox).where(isNotNull(outbox.rejected)).get()?.n ?? 0;
}

// bump the suffix when a server fix makes another class of rejections retryable
const REQUEUE_FLAG = "outboxRequeueV1";

/**
 * one-time: put rejections the server now accepts back in the queue. older
 * servers refused payloads from before migration 2 (missing nullable keys)
 * plus everything that cascaded from them; the server re-evaluates seqs it
 * logged as rejected, so resending them is safe.
 */
export function requeueRetryableRejections(): number {
  const done = db.select({ value: kv.value }).from(kv).where(eq(kv.key, REQUEUE_FLAG)).get();
  if (done) return 0;
  let n = 0;
  db.transaction((tx) => {
    const rows = tx
      .select({ id: outbox.id, rejected: outbox.rejected })
      .from(outbox)
      .where(isNotNull(outbox.rejected))
      .all();
    const ids = rows.filter((r) => isRetryableRejection(r.rejected)).map((r) => r.id);
    for (const part of chunk(ids, 500)) {
      tx.update(outbox).set({ syncedAt: null, rejected: null }).where(inArray(outbox.id, part)).run();
    }
    n = ids.length;
    const at = String(Date.now());
    tx.insert(kv).values({ key: REQUEUE_FLAG, value: at }).onConflictDoUpdate({ target: kv.key, set: { value: at } }).run();
  });
  return n;
}

function readBatch(limit: number): OutboxLike[] {
  return db
    .select({
      id: outbox.id,
      entity: outbox.entity,
      entityId: outbox.entityId,
      op: outbox.op,
      payload: outbox.payload,
      createdAt: outbox.createdAt,
    })
    .from(outbox)
    .where(isNull(outbox.syncedAt))
    .orderBy(asc(outbox.id))
    .limit(limit)
    .all();
}

function ack(plan: AckPlan): void {
  if (!plan.seqs.length) return;
  const now = Date.now();
  db.transaction((tx) => {
    for (const r of plan.rejected) tx.update(outbox).set({ rejected: r.reason }).where(eq(outbox.id, r.seq)).run();
    // only the rows this request carried: a row requeued while it was in flight stays queued
    for (const part of chunk(plan.seqs, 500)) {
      tx.update(outbox)
        .set({ syncedAt: now })
        .where(and(isNull(outbox.syncedAt), inArray(outbox.id, part)))
        .run();
    }
  });
}

// status listeners are separate from db/events so a sync doesn't make every
// screen re-read
let failures = 0;
let nextAllowedAt = 0;
const statusListeners = new Set<() => void>();

export function subscribeSyncStatus(l: () => void): () => void {
  statusListeners.add(l);
  return () => {
    statusListeners.delete(l);
  };
}

function emitStatus(): void {
  for (const l of [...statusListeners]) l();
}

function describe(r: PushResult): string {
  if (!r.ok) {
    const code = r.status ? ` (${r.status})` : "";
    return r.pushed ? `${r.error}${code}, pushed ${r.pushed}` : `${r.error}${code}`;
  }
  if (r.pushed === 0) return "up to date";
  return r.rejected ? `pushed ${r.pushed}, ${r.rejected} rejected` : `pushed ${r.pushed}`;
}

async function run(fetchFn: FetchLike): Promise<PushResult> {
  try {
    requeueRetryableRejections();
  } catch {
    // a failed backfill only means those rows wait; the flag isn't set, so it retries
  }
  const token = (await getToken()) ?? "";
  const result = await pushAll({
    fetch: fetchFn,
    baseUrl: getServerUrl(),
    token,
    deviceId: getDeviceId(),
    readBatch,
    ack,
  });
  const now = Date.now();
  if (result.ok) {
    failures = 0;
    nextAllowedAt = 0;
  } else {
    failures++;
    nextAllowedAt = now + backoffDelay(failures);
  }
  const status: SyncStatus = { at: now, ok: result.ok, message: describe(result) };
  if (!result.ok) status.kind = result.kind;
  setSetting("lastSyncResult", JSON.stringify(status));
  if (result.ok) setSetting("lastSyncAt", String(now));
  return result;
}

// one sync at a time across foreground, interval, finish and manual triggers
const flight = singleFlight<PushResult, FetchLike>(
  (fetchFn) =>
    run(fetchFn).catch(
      (e: unknown): PushResult => ({
        ok: false,
        error: e instanceof Error ? e.message : "sync failed",
        kind: "protocol",
        pushed: 0,
        applied: 0,
        skipped: 0,
        rejected: 0,
        rounds: 0,
      })
    ),
  emitStatus
);

export function isSyncing(): boolean {
  return flight.busy();
}

/** manual sync: ignores backoff, joins a sync already in flight */
export function syncNow(fetchFn: FetchLike = fetch as unknown as FetchLike): Promise<PushResult> {
  return flight.run(fetchFn);
}

/** background attempt: quiet no-op without a token, with nothing to push, or while backing off */
async function autoSync(): Promise<void> {
  try {
    if (flight.busy() || Date.now() < nextAllowedAt) return;
    // requeued rows count as unsynced, so this runs before the empty check
    requeueRetryableRejections();
    if (countUnsynced() === 0) return;
    if (!(await getToken())) return;
    await syncNow();
  } catch {
    // db not migrated yet, keychain locked, ...: the next trigger retries
  }
}

function countFinished(): number | null {
  try {
    return db.select({ n: count() }).from(workouts).where(eq(workouts.status, "finished")).get()?.n ?? 0;
  } catch {
    return null;
  }
}

/** syncs on foreground, every 5 min while foregrounded, and shortly after a workout is finished */
export function useAutoSync(): void {
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      void autoSync();
      interval ??= setInterval(() => void autoSync(), AUTO_INTERVAL_MS);
    };
    const stop = () => {
      if (interval) clearInterval(interval);
      interval = null;
    };
    if (AppState.currentState === "active") start();
    const sub = AppState.addEventListener("change", (s) => (s === "active" ? start() : stop()));

    // db/events has no "finished" event, so watch the finished count after writes
    let finished = countFinished();
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const unsub = subscribe(() => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        const n = countFinished();
        if (n !== null && finished !== null && n > finished) void autoSync();
        finished = n;
      }, 1500);
    });

    return () => {
      stop();
      sub.remove();
      unsub();
      if (debounce) clearTimeout(debounce);
    };
  }, []);
}
