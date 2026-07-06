import { NextResponse } from "next/server";
import { Redis } from "@upstash/redis";
import { getAllActivities, isStravaApiEnabled, CalendarActivity } from "@/lib/strava";
import { isAdminRequest, unauthorizedResponse } from "@/lib/admin-auth";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";

const redis = new Redis({
  url: process.env.KV_REST_API_URL || "",
  token: process.env.KV_REST_API_TOKEN || "",
});

interface StoredActivities {
  activities: CalendarActivity[];
  lastFetchedAt: number;
}

const CACHE_KEY = "strava_activities";

// POST: admin-only full re-fetch from strava. never deletes before writing: the
// old delete-first version wiped the whole activity history when the strava api
// died mid-refresh.
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
    activities.sort((a, b) => b.date.localeCompare(a.date));

    const data: StoredActivities = {
      activities,
      lastFetchedAt: Date.now(),
    };

    await redis.set(CACHE_KEY, data);

    return NextResponse.json({
      success: true,
      count: activities.length,
      lastFetchedAt: data.lastFetchedAt,
    });
  } catch (error) {
    log.error("api:strava/full-refresh", "full refresh failed, existing data untouched", error);
    return NextResponse.json({ success: false, error: "refresh failed" }, { status: 500 });
  }
}
