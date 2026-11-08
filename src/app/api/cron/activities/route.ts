import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { isIntervalsConfigured, pullIntervalsActivities } from "@/lib/intervals";
import { unauthorizedResponse } from "@/lib/admin-auth";
import { log } from "@/lib/log";
import { DEFAULT_REBUILD_BUDGET_MS, republishPending } from "@/lib/privacy/rebuild";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// leave headroom under maxDuration for the slowest single republish: no
// republish starts after 35 s of this run, and the rebuild gets at most 30 s
const CRON_DEADLINE_MS = 35_000;
const CRON_REBUILD_MAX_MS = 30_000;
const MIN_REBUILD_MS = 5_000;

// scheduled safety net behind the intervals.icu webhook (vercel cron + github
// actions): pull new activities and recent metadata edits, then, in whatever
// time is left, republish activities that zone/settings changes left pending.
export async function GET(request: Request) {
  const started = Date.now();
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return unauthorizedResponse();
  }

  const out: Record<string, unknown> = {};
  if (isIntervalsConfigured()) {
    try {
      out.intervals = await pullIntervalsActivities();
    } catch (error) {
      log.error("cron:activities", "intervals.icu pull failed", error);
      out.intervals = { error: (error as Error).message };
    }
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
  return NextResponse.json({ ok: true, ...out });
}
