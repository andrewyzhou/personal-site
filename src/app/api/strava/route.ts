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

async function syncCalendarActivities(stored: StoredActivities | null) {
  try {
    let activities: CalendarActivity[];

    if (stored && stored.activities.length > 0) {
      // Incremental update: find the most recent activity's date and fetch after that
      // Use the date of the most recent activity (already sorted descending)
      const mostRecentDate = stored.activities[0].date; // YYYY-MM-DD format
      // Convert to Unix timestamp (start of that day in UTC, minus 1 day for safety)
      const afterDate = new Date(mostRecentDate + "T00:00:00Z");
      afterDate.setDate(afterDate.getDate() - 1); // go back 1 day to catch any we missed
      const afterTimestamp = Math.floor(afterDate.getTime() / 1000);

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

  if (!activity) {
    return null;
  }

  // Check if calendar cache needs updating
  const stored = await redis.get<StoredActivities>(CALENDAR_CACHE_KEY);
  const cachedLatestId = stored?.activities?.[0]?.id ?? null;

  if (activity.id !== cachedLatestId) {
    await syncCalendarActivities(stored);
  }

  return {
    ...activity,
    latestActivityId: activity.id,
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
