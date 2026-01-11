import { NextResponse } from "next/server";
import { getLatestActivity, formatDistance, formatDuration, formatTimeAgo } from "@/lib/strava";
import { getCachedData } from "@/lib/cache";

export const dynamic = "force-dynamic"; // disable next.js caching, we use redis

async function fetchStravaData() {
  const activity = await getLatestActivity();

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
