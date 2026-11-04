import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { isStravaApiEnabled } from "@/lib/strava";
import { syncStravaActivities } from "@/lib/strava-sync";
import { isIntervalsConfigured, pullIntervalsActivities } from "@/lib/intervals";
import { unauthorizedResponse } from "@/lib/admin-auth";
import { log } from "@/lib/log";
import { DEFAULT_REBUILD_BUDGET_MS, republishPending } from "@/lib/privacy/rebuild";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// leave headroom under maxDuration for the slowest single republish
const CRON_DEADLINE_MS = 45_000;
const MIN_REBUILD_MS = 5_000;

// scheduled import from every configured source (vercel cron + github actions).
// strava first: when both have the same workout, intervals.icu then upgrades
// the strava row with the original file instead of the strava row merging later.
// then, in whatever time is left, republish activities that zone/settings
// changes left pending.
export async function GET(request: Request) {
  const started = Date.now();
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return unauthorizedResponse();
  }

  const out: Record<string, unknown> = {};
  if (isStravaApiEnabled()) {
    try {
      out.strava = await syncStravaActivities();
    } catch (error) {
      log.error("cron:activities", "strava sync failed", error);
      out.strava = { error: (error as Error).message };
    }
  }
  if (isIntervalsConfigured()) {
    try {
      out.intervals = await pullIntervalsActivities();
    } catch (error) {
      log.error("cron:activities", "intervals.icu pull failed", error);
      out.intervals = { error: (error as Error).message };
    }
  }

  const budget = Math.min(CRON_DEADLINE_MS - (Date.now() - started), DEFAULT_REBUILD_BUDGET_MS);
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
  return NextResponse.json({ ok: true, ...out });
}
