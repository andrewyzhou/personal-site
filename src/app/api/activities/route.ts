import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { getDb, activities } from "@/lib/db";
import { isPublic, publicCalendarActivity } from "@/lib/public-activity";
import { getCachedData } from "@/lib/cache";
import { log } from "@/lib/log";
import { liftCalendarEntries } from "@/lib/lift/public";
import type { CalendarActivity } from "@/lib/calendar-activity";

export const dynamic = "force-dynamic";

// the public activity history for the calendar: full history, date
// desc, no polylines. rows go through
// the public serializer before they're cached, so the kv copy is public too.
async function fetchActivities(): Promise<CalendarActivity[]> {
  const rows = await getDb()
    .select()
    .from(activities)
    .where(eq(activities.hidden, false))
    .orderBy(desc(activities.localDate), desc(activities.localTime));
  // the where clause already drops private rows; filtered again so a query
  // change can never publish one
  return rows.filter(isPublic).map(publicCalendarActivity);
}

export async function GET() {
  try {
    const { data, fetchedAt } = await getCachedData("activities_list", fetchActivities);
    // lift-only workouts ride alongside so `activities` keeps its exact shape for other readers
    const lifts = await liftCalendarEntries();
    return NextResponse.json({ activities: data ?? [], lifts, lastFetchedAt: fetchedAt });
  } catch (error) {
    log.error("api:activities", "list fetch failed", error);
    return NextResponse.json({ activities: [], lastFetchedAt: null }, { status: 500 });
  }
}
