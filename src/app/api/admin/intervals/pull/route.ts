import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { isIntervalsConfigured, pullIntervalsActivities } from "@/lib/intervals";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// admin "pull latest". ?days=N widens the lookback (default 7) for backfills.
export async function POST(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  if (!isIntervalsConfigured()) {
    return NextResponse.json({ ok: false, error: "intervals.icu is not configured" }, { status: 503 });
  }
  const days = Number(new URL(request.url).searchParams.get("days"));
  try {
    const result = await pullIntervalsActivities(
      Number.isInteger(days) && days > 0 && days <= 3650 ? { days } : {}
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    log.error("admin:intervals/pull", "pull failed", error);
    return NextResponse.json({ ok: false, error: (error as Error).message }, { status: 502 });
  }
}
