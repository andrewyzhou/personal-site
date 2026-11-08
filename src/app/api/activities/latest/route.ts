import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { getDb, activities } from "@/lib/db";
import { isPublic, publicStartUtc } from "@/lib/public-activity";
import { getCachedData } from "@/lib/cache";
import { log } from "@/lib/log";
import { formatDistanceShort, formatDurationWords, formatTimeAgo } from "@/lib/activity-format";

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

// the latest public activity (Currently's workout sentence); the response
// passes isLatestActivity() in src/lib/validate.ts.
// startDate is the published (possibly coarsened) start, never the raw one.
async function fetchLatest(): Promise<LatestActivity | null> {
  const rows = await getDb()
    .select()
    .from(activities)
    .where(eq(activities.hidden, false))
    .orderBy(desc(activities.startDateUtc))
    .limit(1);
  const row = rows.find(isPublic);
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    type: row.sportType,
    distance: row.distanceM,
    movingTime: row.movingTimeS,
    elapsedTime: row.elapsedTimeS,
    startDate: publicStartUtc(row).toISOString(),
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
      formattedDistance: formatDistanceShort(data.distance),
      formattedDuration: formatDurationWords(data.elapsedTime),
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
