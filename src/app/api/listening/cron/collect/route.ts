import { NextResponse } from "next/server";
import { unauthorizedResponse } from "@/lib/admin-auth";
import { log } from "@/lib/log";
import { ListeningNotMigratedError, isListeningConfigured, runListeningCollect } from "@/lib/listening/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// listening history collector: github actions every 15 min, vercel cron daily
// as a fallback. safe to call any time: a run with nothing new writes no plays.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return unauthorizedResponse();
  }
  if (!isListeningConfigured()) {
    return NextResponse.json({ ok: true, skipped: "spotify not configured" });
  }
  try {
    const r = await runListeningCollect();
    if (!r.ok) log.warn("cron:listening", `collect failed: ${r.error}`);
    return NextResponse.json(r, { status: r.ok ? 200 : 502 });
  } catch (error) {
    // deployed ahead of the migration: not a failure worth alerting on
    if (error instanceof ListeningNotMigratedError) {
      return NextResponse.json({ ok: true, skipped: "not migrated" });
    }
    log.error("cron:listening", "collect threw", error);
    return NextResponse.json({ ok: false, error: (error as Error).message }, { status: 500 });
  }
}
