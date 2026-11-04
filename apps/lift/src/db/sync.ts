// push-only sync client: outbox -> POST /api/lift/sync. the app token lives in
// the keychain only; server url, device id and the last result live in kv.

import { useEffect } from "react";
import { AppState } from "react-native";
import { and, asc, count, eq, isNull, lte } from "drizzle-orm";
import { randomUUID } from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { db } from "./client";
import { subscribe } from "./events";
import { getSetting, setSetting } from "./settings";
import { outbox, workouts } from "./schema";
import { backoffDelay } from "../lib/sync/backoff";
import type { AckPlan, OutboxLike } from "../lib/sync/mutations";
import { pushAll, type FetchLike, type PushResult } from "../lib/sync/push";

export const DEFAULT_SERVER_URL = "https://www.andrewzhou.org";
const TOKEN_KEY = "lift.appToken";
const AUTO_INTERVAL_MS = 5 * 60_000;

export function getServerUrl(): string {
  return getSetting("serverUrl") || DEFAULT_SERVER_URL;
}

export function setServerUrl(url: string): void {
  setSetting("serverUrl", url.trim());
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
  if (plan.syncedThrough === null) return;
  const through = plan.syncedThrough;
  const now = Date.now();
  db.transaction((tx) => {
    for (const r of plan.rejected) tx.update(outbox).set({ rejected: r.reason }).where(eq(outbox.id, r.seq)).run();
    tx.update(outbox)
      .set({ syncedAt: now })
      .where(and(isNull(outbox.syncedAt), lte(outbox.id, through)))
      .run();
  });
}

// one sync at a time; status listeners are separate from db/events so a sync
// doesn't make every screen re-read
let inflight: Promise<PushResult> | null = null;
let failures = 0;
let nextAllowedAt = 0;
const statusListeners = new Set<() => void>();

export function subscribeSyncStatus(l: () => void): () => void {
  statusListeners.add(l);
  return () => {
    statusListeners.delete(l);
  };
}

export function isSyncing(): boolean {
  return inflight !== null;
}

function describe(r: PushResult): string {
  if (!r.ok) return r.pushed ? `${r.error} (pushed ${r.pushed})` : r.error;
  if (r.pushed === 0) return "up to date";
  return r.rejected ? `pushed ${r.pushed}, ${r.rejected} rejected` : `pushed ${r.pushed}`;
}

async function run(fetchFn: FetchLike): Promise<PushResult> {
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
  setSetting("lastSyncResult", JSON.stringify(status));
  if (result.ok) setSetting("lastSyncAt", String(now));
  return result;
}

/** manual sync: ignores backoff, joins a sync already in flight */
export function syncNow(fetchFn: FetchLike = fetch as unknown as FetchLike): Promise<PushResult> {
  if (inflight) return inflight;
  const p = run(fetchFn)
    .catch(
      (e: unknown): PushResult => ({
        ok: false,
        error: e instanceof Error ? e.message : "sync failed",
        pushed: 0,
        applied: 0,
        skipped: 0,
        rejected: 0,
        rounds: 0,
      })
    )
    .finally(() => {
      inflight = null;
      for (const l of [...statusListeners]) l();
    });
  inflight = p;
  for (const l of [...statusListeners]) l();
  return p;
}

/** background attempt: quiet no-op without a token, with nothing to push, or while backing off */
async function autoSync(): Promise<void> {
  try {
    if (inflight || Date.now() < nextAllowedAt) return;
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
