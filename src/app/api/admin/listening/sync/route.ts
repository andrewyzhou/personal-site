import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { log } from "@/lib/log";
import { runListeningCollect } from "@/lib/listening/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST { dryRun? }: "sync now" from /admin/listening. same run as the cron.
export async function POST(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  let dryRun = false;
  try {
    const body = await request.json();
    dryRun = body?.dryRun === true;
  } catch {
    // no body: a real run
  }
  try {
    const r = await runListeningCollect({ dryRun });
    return NextResponse.json(r, { status: r.ok ? 200 : 502 });
  } catch (error) {
    log.error("admin:listening:sync", "sync failed", error);
    return NextResponse.json({ ok: false, error: (error as Error).message }, { status: 500 });
  }
}
