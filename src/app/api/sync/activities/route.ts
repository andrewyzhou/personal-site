import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { unauthorizedResponse } from "@/lib/admin-auth";
import { log } from "@/lib/log";
import { syncActivitiesNow } from "@/lib/activity-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// the frequent pull (github actions every 10 minutes through the day): new
// activities and metadata edits from the last few days, every source. the
// daily cron does the wider sweep and the privacy rebuild.
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return unauthorizedResponse();
  }
  try {
    const result = await syncActivitiesNow({ trigger: "poll" });
    if (result.changed) {
      revalidatePath("/training");
      revalidatePath("/activities/[id]", "page");
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    log.error("api:sync/activities", "sync failed", error);
    return NextResponse.json({ ok: false, error: (error as Error).message }, { status: 500 });
  }
}
