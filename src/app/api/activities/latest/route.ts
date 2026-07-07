import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { getDb, activities } from "@/lib/db";
import { getCachedData } from "@/lib/cache";
import { log } from "@/lib/log";
import { formatDistance, formatDuration, formatTimeAgo } from "@/lib/strava";

export const dynamic = "force-dynamic";

interface LatestActivity {
  id: number;
  name: string;
  type: string;
  distance: number;
  movingTime: number;
  elapsedTime: number;
  startDate: string;
}

// shape-identical replacement for /api/strava (Currently's workout sentence);
// the response passes isStravaActivity() in src/lib/validate.ts unchanged
async function fetchLatest(): Promise<LatestActivity | null> {
  const rows = await getDb()
    .select()
    .from(activities)
    .where(eq(activities.hidden, false))
    .orderBy(desc(activities.startDateUtc))
    .limit(1);
  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    id: row.id,
    name: row.name,
    type: row.sportType,
    distance: row.distanceM,
    movingTime: row.movingTimeS,
    elapsedTime: row.elapsedTimeS,
    startDate: row.startDateUtc.toISOString(),
  };
}

export async function GET() {
  try {
    const { data, fetchedAt, previousFetchedAt, stale } = await getCachedData("activities_latest", fetchLatest);

    if (data === null) {
      return NextResponse.json(null);
    }

    return NextResponse.json({
      ...data,
      latestActivityId: data.id,
      formattedDistance: formatDistance(data.distance),
      formattedDuration: formatDuration(data.elapsedTime),
      formattedTimeAgo: formatTimeAgo(data.startDate),
      fetchedAt,
      previousFetchedAt,
      stale,
    });
  } catch (error) {
    log.error("api:activities/latest", "fetch failed", error);
    return NextResponse.json(null, { status: 500 });
  }
}
