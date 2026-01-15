import { NextResponse } from "next/server";
import { getAllActivities, CalendarActivity } from "@/lib/strava";
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

export async function POST() {
  try {
    // Clear existing cache
    await redis.del(CALENDAR_CACHE_KEY);

    // Fetch all activities fresh
    const activities = await getAllActivities();

    // Sort by date descending
    activities.sort((a, b) => b.date.localeCompare(a.date));

    const data: StoredActivities = {
      activities,
      lastFetchedAt: Date.now(),
    };

    await redis.set(CALENDAR_CACHE_KEY, data);

    return NextResponse.json({
      success: true,
      activitiesCount: activities.length
    });
  } catch (error) {
    console.error("Error refreshing strava cache:", error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
