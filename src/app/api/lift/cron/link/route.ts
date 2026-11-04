import { NextResponse } from "next/server";
import { relinkRecentWorkouts } from "@/lib/lift/link";
import { bearerMatches } from "@/lib/lift/auth";
import { unauthorizedResponse } from "@/lib/admin-auth";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// daily sweep: the watch recording often lands after the workout was shared,
// so unlinked workouts from the last two weeks get another try. scheduled
// after the activities cron so that day's imports are already in.
export async function GET(request: Request) {
  if (!bearerMatches(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return unauthorizedResponse();
  }
  try {
    const result = await relinkRecentWorkouts(14);
    log.info("cron:lift-link", JSON.stringify(result));
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    log.error("cron:lift-link", "relink failed", error);
    return NextResponse.json({ ok: false, error: (error as Error).message }, { status: 500 });
  }
}
