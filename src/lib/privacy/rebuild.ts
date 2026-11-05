// bulk republish (server-only): everything flagged needs_republish or built by
// an older processing version, newest first, within a time budget. a failure
// leaves the row pending (republish only clears the flag on success).

import { and, desc, eq, notInArray, sql } from "drizzle-orm";
import { getDb, activities } from "../db";
import { invalidateCache } from "../cache";
import { log } from "../log";
import { republish, type RepublishResult } from "../republish";
import { countPending, pendingWhere } from "./stale";

// no new republish starts after this; the function limit is 60 s, so one slow
// republish still fits
export const DEFAULT_REBUILD_BUDGET_MS = 30_000;
export const DEFAULT_REBUILD_LIMIT = 100;
export const REBUILD_CONCURRENCY = 6;
const MAX_EXCLUDE = 1000;

export interface RebuildDeps {
  selectPending(limit: number, excludeIds: number[]): Promise<number[]>;
  markAttempted(id: number): Promise<void>;
  countPending(): Promise<number>;
  republish(id: number): Promise<RepublishResult>;
  invalidate(): Promise<void>;
  now(): number;
}

export interface RebuildOptions {
  limit?: number;
  timeBudgetMs?: number;
  // ids to skip (e.g. ones that already failed in this rebuild run)
  excludeIds?: number[];
  // republishes in flight at once (default REBUILD_CONCURRENCY)
  concurrency?: number;
  // next/cache revalidatePath, only when called from a route
  revalidate?: (path: string) => void;
  deps?: Partial<RebuildDeps>;
}

export interface RebuildItem {
  id: number;
  status: RepublishResult["status"] | "error";
  error?: string;
}

export interface RebuildReport {
  results: RebuildItem[];
  failedIds: number[]; // still pending after this batch
  remaining: number;
  timedOut: boolean;
}

// statuses that wrote public columns (no-source still writes the published start)
const WROTE = new Set<RebuildItem["status"]>(["published", "no-source"]);
// statuses that leave the row pending
const FAILED = new Set<RebuildItem["status"]>(["error", "source-unavailable"]);

export function defaultRebuildDeps(): RebuildDeps {
  return {
    async selectPending(limit, excludeIds) {
      const where = excludeIds.length ? and(pendingWhere(), notInArray(activities.id, excludeIds)) : pendingWhere();
      const rows = await getDb()
        .select({ id: activities.id })
        .from(activities)
        .where(where)
        // never-attempted first, then least recently attempted: a row that keeps
        // failing can't block the rest of the queue
        .orderBy(sql`${activities.republishAttemptedAt} asc nulls first`, desc(activities.startDateUtc), desc(activities.id))
        .limit(limit);
      return rows.map((r) => r.id);
    },
    async markAttempted(id) {
      await getDb().update(activities).set({ republishAttemptedAt: new Date() }).where(eq(activities.id, id));
    },
    countPending,
    republish: (id) => republish(id),
    invalidate: () => invalidateCache("activities_list", "activities_latest"),
    now: () => Date.now(),
  };
}

export async function republishPending(opts: RebuildOptions = {}): Promise<RebuildReport> {
  const deps: RebuildDeps = { ...defaultRebuildDeps(), ...opts.deps };
  const limit = Math.max(1, Math.min(500, Math.floor(opts.limit ?? DEFAULT_REBUILD_LIMIT)));
  const budget = Math.max(0, opts.timeBudgetMs ?? DEFAULT_REBUILD_BUDGET_MS);
  const exclude = (opts.excludeIds ?? []).filter((n) => Number.isInteger(n)).slice(0, MAX_EXCLUDE);
  const started = deps.now();

  const afterWrite = async (id: number) => {
    try {
      await deps.invalidate();
    } catch (error) {
      log.warn("privacy:rebuild", "cache invalidation failed", error);
    }
    if (!opts.revalidate) return;
    try {
      opts.revalidate(`/activities/${id}`);
    } catch (error) {
      log.warn("privacy:rebuild", `revalidate ${id} failed`, error);
    }
  };

  const ids = await deps.selectPending(limit, exclude);
  const slots: (RebuildItem | undefined)[] = new Array(ids.length);
  let timedOut = false;
  let next = 0;
  // a few republishes in flight at once (each is mostly network waits); no new
  // one starts after the budget, so results stay a prefix of the queue
  const worker = async () => {
    while (next < ids.length) {
      if (deps.now() - started >= budget) {
        timedOut = true;
        return;
      }
      const index = next++;
      const id = ids[index];
      let item: RebuildItem;
      try {
        await deps.markAttempted(id);
        const r = await deps.republish(id);
        item = { id, status: r.status };
      } catch (error) {
        log.error("privacy:rebuild", `republish ${id} failed`, error);
        item = { id, status: "error", error: (error as Error).message };
      }
      slots[index] = item;
      // caches and the page go fresh as soon as each row is written: a batch cut
      // off by the function limit still leaves every rewritten page current
      if (WROTE.has(item.status)) await afterWrite(id);
    }
  };
  const concurrency = Math.max(1, Math.min(Math.floor(opts.concurrency ?? REBUILD_CONCURRENCY), ids.length));
  await Promise.all(Array.from({ length: concurrency }, worker));
  const results = slots.filter((r): r is RebuildItem => r !== undefined);

  return {
    results,
    failedIds: results.filter((r) => FAILED.has(r.status)).map((r) => r.id),
    remaining: await deps.countPending(),
    timedOut,
  };
}
