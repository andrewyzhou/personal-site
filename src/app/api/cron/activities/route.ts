import { NextResponse } from "next/server";
import { isStravaApiEnabled } from "@/lib/strava";
import { syncStravaActivities } from "@/lib/strava-sync";
import { isIntervalsConfigured, pullIntervalsActivities } from "@/lib/intervals";
import { unauthorizedResponse } from "@/lib/admin-auth";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// scheduled import from every configured source (vercel cron + github actions).
// strava first: when both have the same workout, intervals.icu then upgrades
// the strava row with the original file instead of the strava row merging later.
export async function GET(request: Request) {
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
  return NextResponse.json({ ok: true, ...out });
}
