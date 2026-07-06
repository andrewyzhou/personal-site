import { NextResponse } from "next/server";
import { getAllActivities, isStravaApiEnabled, CalendarActivity } from "@/lib/strava";
import { isAdminRequest, unauthorizedResponse } from "@/lib/admin-auth";
import { log } from "@/lib/log";
import { Redis } from "@upstash/redis";

export const dynamic = "force-dynamic";

const redis = new Redis({
  url: process.env.KV_REST_API_URL || "",
  token: process.env.KV_REST_API_TOKEN || "",
});

const CALENDAR_CACHE_KEY = "strava_activities";

interface StoredActivities {
  activities: CalendarActivity[];
  lastFetchedAt: number;
}

// admin-only full re-fetch. never deletes before writing: the old delete-first
// version wiped the whole activity history when the strava api died mid-refresh.
export async function POST(request: Request) {
  if (!isAdminRequest(request)) {
    return unauthorizedResponse();
  }

  if (!isStravaApiEnabled()) {
    return NextResponse.json(
      { success: false, error: "strava api is disabled (STRAVA_API_ENABLED)" },
      { status: 503 }
    );
  }

  try {
    // fetch first — throws on api failure, leaving existing data untouched
    const activities = await getAllActivities();

    // sort by date descending
    activities.sort((a, b) => b.date.localeCompare(a.date));

    const data: StoredActivities = {
      activities,
      lastFetchedAt: Date.now(),
    };

    await redis.set(CALENDAR_CACHE_KEY, data);

    return NextResponse.json({
      success: true,
      activitiesCount: activities.length,
    });
  } catch (error) {
    log.error("api:strava/refresh", "full refresh failed, existing data untouched", error);
    return NextResponse.json({ success: false, error: "refresh failed" }, { status: 500 });
  }
}
