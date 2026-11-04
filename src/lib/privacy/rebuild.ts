// bulk republish (server-only): everything flagged needs_republish or built by
// an older processing version, newest first, within a time budget. a failure
// leaves the row pending (republish only clears the flag on success).

import { and, desc, eq, notInArray, sql } from "drizzle-orm";
import { getDb, activities } from "../db";
import { invalidateCache } from "../cache";
import { log } from "../log";
import { republish, type RepublishResult } from "../republish";
import { countPending, pendingWhere } from "./stale";

export const DEFAULT_REBUILD_BUDGET_MS = 40_000; // function limit is 60 s
export const DEFAULT_REBUILD_LIMIT = 50;
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

  const ids = await deps.selectPending(limit, exclude);
  const results: RebuildItem[] = [];
  let timedOut = false;
  for (const id of ids) {
    if (deps.now() - started >= budget) {
      timedOut = true;
      break;
    }
    try {
      await deps.markAttempted(id);
      const r = await deps.republish(id);
      results.push({ id, status: r.status });
    } catch (error) {
      log.error("privacy:rebuild", `republish ${id} failed`, error);
      results.push({ id, status: "error", error: (error as Error).message });
    }
  }

  const wrote = results.filter((r) => WROTE.has(r.status));
  if (wrote.length) {
    await deps.invalidate();
    if (opts.revalidate) {
      for (const r of wrote) {
        try {
          opts.revalidate(`/activities/${r.id}`);
        } catch (error) {
          log.warn("privacy:rebuild", `revalidate ${r.id} failed`, error);
        }
      }
    }
  }

  return {
    results,
    failedIds: results.filter((r) => FAILED.has(r.status)).map((r) => r.id),
    remaining: await deps.countPending(),
    timedOut,
  };
}
