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

// POST: Clear cache and do a full fetch from Strava
export async function POST() {
  try {
    await redis.del(CACHE_KEY);

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
    console.error("Error doing full refresh:", error);
    return NextResponse.json({ success: false, error: "Failed to refresh" }, { status: 500 });
  }
}
