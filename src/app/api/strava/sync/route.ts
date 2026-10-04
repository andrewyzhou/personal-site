import { NextResponse } from "next/server";
import { syncStravaActivities } from "@/lib/strava-sync";
import { isStravaApiEnabled } from "@/lib/strava";
import { isAdminRequest, unauthorizedResponse } from "@/lib/admin-auth";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function run() {
  if (!isStravaApiEnabled()) {
    return NextResponse.json({ ok: false, error: "strava api is disabled (STRAVA_API_ENABLED)" }, { status: 503 });
  }
  try {
    const result = await syncStravaActivities();
    if (result.failures.length > 0) {
      log.warn("api:strava/sync", `sync had failures: ${JSON.stringify(result.failures)}`);
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    log.error("api:strava/sync", "sync failed", error);
    return NextResponse.json({ ok: false, error: "sync failed" }, { status: 500 });
  }
}

// vercel cron: GET with `Authorization: Bearer $CRON_SECRET`
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return unauthorizedResponse();
  }
  return run();
}

// admin: manual "sync now"
export async function POST(request: Request) {
  if (!(await isAdminRequest(request))) {
    return unauthorizedResponse();
  }
  return run();
}
