import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { syncActivitiesNow } from "@/lib/activity-sync";
import { unauthorizedResponse } from "@/lib/admin-auth";
import { log } from "@/lib/log";
import { DEFAULT_REBUILD_BUDGET_MS, republishPending } from "@/lib/privacy/rebuild";
import { pruneApiCalls, syncEvent, withSyncRun } from "@/lib/sync-log";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// leave headroom under maxDuration for the slowest single republish: no
// republish starts after 35 s of this run, and the rebuild gets at most 30 s
const CRON_DEADLINE_MS = 35_000;
const CRON_REBUILD_MAX_MS = 30_000;
const MIN_REBUILD_MS = 5_000;
const DAILY_IMPORT_DAYS = 7;
const DAILY_METADATA_DAYS = 14; // renames made upstream, re-checked this far back

// the daily sweep behind the webhook and the frequent pull (vercel cron +
// github actions): every source over the wider window, then, in whatever time
// is left, republish activities that zone/settings changes left pending, and
// drop sync-log api_call rows past their retention.
export async function GET(request: Request) {
  const started = Date.now();
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return unauthorizedResponse();
  }

  const out = await withSyncRun({ trigger: "cron", source: "activities" }, async () => {
    const out: Record<string, unknown> = {};
    try {
      const sync = await syncActivitiesNow({ trigger: "cron", days: DAILY_IMPORT_DAYS, metadataDays: DAILY_METADATA_DAYS });
      out.garmin = sync.garmin;
      out.intervals = sync.intervals;
    } catch (error) {
      log.error("cron:activities", "activity sync failed", error);
      out.sync = { error: (error as Error).message };
    }

    const budget = Math.min(CRON_DEADLINE_MS - (Date.now() - started), CRON_REBUILD_MAX_MS, DEFAULT_REBUILD_BUDGET_MS);
    if (budget >= MIN_REBUILD_MS) {
      try {
        const r = await republishPending({ timeBudgetMs: budget, revalidate: revalidatePath });
        out.rebuild = { processed: r.results.length, failed: r.failedIds.length, remaining: r.remaining };
      } catch (error) {
        log.error("cron:activities", "privacy rebuild failed", error);
        out.rebuild = { error: (error as Error).message };
      }
    } else {
      out.rebuild = { skipped: "no time left" };
    }

    try {
      out.prunedApiCalls = await pruneApiCalls();
    } catch (error) {
      // before the sync_events migration, or a db hiccup: never fails the cron
      await syncEvent({ source: "activities", kind: "error", detail: { message: `prune: ${(error as Error).message}` } });
    }
    return out;
  });
  return NextResponse.json({ ok: true, ...out });
}
