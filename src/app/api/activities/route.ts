import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { getDb, activities } from "@/lib/db";
import { rowToCalendarActivity } from "@/lib/activities";
import { getCachedData } from "@/lib/cache";
import { log } from "@/lib/log";
import type { CalendarActivity } from "@/lib/strava";

export const dynamic = "force-dynamic";

// shape-identical replacement for /api/strava/activities: full history, date
// desc, no polylines (payload parity with the old response)
async function fetchActivities(): Promise<CalendarActivity[]> {
  const rows = await getDb()
    .select()
    .from(activities)
    .where(eq(activities.hidden, false))
    .orderBy(desc(activities.localDate), desc(activities.localTime));
  return rows.map(rowToCalendarActivity);
}

export async function GET() {
  try {
    const { data, fetchedAt } = await getCachedData("activities_list", fetchActivities);
    return NextResponse.json({ activities: data ?? [], lastFetchedAt: fetchedAt });
  } catch (error) {
    log.error("api:activities", "list fetch failed", error);
    return NextResponse.json({ activities: [], lastFetchedAt: null }, { status: 500 });
  }
}
