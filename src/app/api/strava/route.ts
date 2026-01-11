import { NextResponse } from "next/server";
import { getLatestActivity, getAllActivities, formatDistance, formatDuration, formatTimeAgo, CalendarActivity } from "@/lib/strava";
import { getCachedData } from "@/lib/cache";
import { Redis } from "@upstash/redis";

export const dynamic = "force-dynamic"; // disable next.js caching, we use redis

const redis = new Redis({
  url: process.env.KV_REST_API_URL || "",
  token: process.env.KV_REST_API_TOKEN || "",
});

const CALENDAR_CACHE_KEY = "strava_activities";

interface StoredActivities {
  activities: CalendarActivity[];
  lastFetchedAt: number;
}

// Sync calendar activities in the background (fire and forget)
async function syncCalendarActivities() {
  try {
    const stored = await redis.get<StoredActivities>(CALENDAR_CACHE_KEY);

    let activities: CalendarActivity[];

    if (stored && stored.activities.length > 0) {
      // Incremental update: only fetch activities after last fetch
      const afterTimestamp = Math.floor(stored.lastFetchedAt / 1000);
      const newActivities = await getAllActivities(afterTimestamp);

      // Merge new activities with existing, avoiding duplicates
      const existingIds = new Set(stored.activities.map(a => a.id));
      const uniqueNew = newActivities.filter(a => !existingIds.has(a.id));
      activities = [...uniqueNew, ...stored.activities];
    } else {
      // Initial fetch: get all activities
      activities = await getAllActivities();
    }

    // Sort by date descending
    activities.sort((a, b) => b.date.localeCompare(a.date));

    const data: StoredActivities = {
      activities,
      lastFetchedAt: Date.now(),
    };

    await redis.set(CALENDAR_CACHE_KEY, data);
  } catch (error) {
    console.error("Error syncing calendar activities:", error);
  }
}

async function fetchStravaData() {
  const activity = await getLatestActivity();

  // Also sync calendar activities when we fetch fresh data
  syncCalendarActivities(); // fire and forget (no await)

  if (!activity) {
    return null;
  }

  return {
    ...activity,
    formattedDistance: formatDistance(activity.distance),
    formattedDuration: formatDuration(activity.elapsedTime),
    formattedTimeAgo: formatTimeAgo(activity.startDate),
  };
}

export async function GET() {
  try {
    const { data, fetchedAt, previousFetchedAt } = await getCachedData("strava", fetchStravaData);

    if (data === null) {
      return NextResponse.json(null);
    }

    return NextResponse.json({ ...data, fetchedAt, previousFetchedAt });
  } catch (error) {
    console.error("strava api error:", error);
    return NextResponse.json(null, { status: 500 });
  }
}
