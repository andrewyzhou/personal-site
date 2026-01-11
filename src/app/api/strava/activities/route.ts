import { NextResponse } from "next/server";
import { Redis } from "@upstash/redis";
import { getAllActivities, CalendarActivity } from "@/lib/strava";

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

// GET: Return cached activities
export async function GET() {
  try {
    const stored = await redis.get<StoredActivities>(CACHE_KEY);

    if (!stored) {
      return NextResponse.json({ activities: [], lastFetchedAt: null });
    }

    return NextResponse.json(stored);
  } catch (error) {
    console.error("Error fetching stored activities:", error);
    return NextResponse.json({ activities: [], lastFetchedAt: null }, { status: 500 });
  }
}

// POST: Fetch activities from Strava and store in Redis
export async function POST() {
  try {
    const stored = await redis.get<StoredActivities>(CACHE_KEY);

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

    // Sort by date descending (newest first)
    activities.sort((a, b) => b.date.localeCompare(a.date));

    const data: StoredActivities = {
      activities,
      lastFetchedAt: Date.now(),
    };

    // Store in Redis (no expiry - persistent storage)
    await redis.set(CACHE_KEY, data);

    return NextResponse.json({
      success: true,
      count: activities.length,
      lastFetchedAt: data.lastFetchedAt
    });
  } catch (error) {
    console.error("Error syncing activities:", error);
    return NextResponse.json({ success: false, error: "Failed to sync" }, { status: 500 });
  }
}
