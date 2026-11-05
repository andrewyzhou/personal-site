import { and, asc, eq } from "drizzle-orm";
import { getDb, activities, activityPhotos, type ActivityRow } from "@/lib/db";
import { loadActivityLiftWorkouts } from "@/lib/lift/public";
import { loadPublicMetrics } from "@/lib/metrics/load";
import { isPublic, publicActivityDetail } from "@/lib/public-activity";
import {
  DURATION_ONLY_TYPES,
  PACE_TYPES,
  SPEED_TYPES,
  formatClockDuration,
  formatFeet,
  formatLocalDateLine,
  formatMiles,
  formatMph,
  formatPace,
  sportIcon,
  sportLabel,
} from "@/lib/activity-format";

// everything an activity page shows, loaded and formatted once. every design
// renders this; none queries or formats on its own.

export async function loadActivityRow(idStr: string): Promise<ActivityRow | null> {
  const id = Number(idStr);
  if (!Number.isInteger(id) || id <= 0) return null;
  const rows = await getDb()
    .select()
    .from(activities)
    .where(and(eq(activities.id, id), eq(activities.hidden, false)))
    .limit(1);
  const row = rows[0];
  return row && isPublic(row) ? row : null;
}

// "in the fog · 14 min": total hidden time, whole minutes
export function fogLine(fogEvents: { durationS: number }[] | null): string | null {
  const totalS = (fogEvents ?? []).reduce((s, e) => s + (Number.isFinite(e.durationS) ? e.durationS : 0), 0);
  const min = Math.round(totalS / 60);
  return min > 0 ? `in the fog · ${min} min` : null;
}

export interface ActivityStat {
  label: string;
  value: string;
}

export function activityStats(a: ReturnType<typeof publicActivityDetail>): ActivityStat[] {
  const durationOnly = DURATION_ONLY_TYPES.has(a.type);
  const stats: ActivityStat[] = [];
  stats.push({ label: "time", value: formatClockDuration(a.duration || a.elapsedTime) });
  if (!durationOnly && a.distance > 100) {
    stats.push({ label: "distance", value: formatMiles(a.distance) });
    if (PACE_TYPES.has(a.type)) stats.push({ label: "avg pace", value: formatPace(a.averageSpeed) });
    else if (SPEED_TYPES.has(a.type)) stats.push({ label: "avg speed", value: formatMph(a.averageSpeed) });
    if (a.totalElevationGain > 1) stats.push({ label: "elevation", value: formatFeet(a.totalElevationGain) });
  }
  if (a.averageHeartrate !== null) stats.push({ label: "avg hr", value: `${Math.round(a.averageHeartrate)} bpm` });
  if (a.maxHeartrate !== null) stats.push({ label: "max hr", value: `${Math.round(a.maxHeartrate)} bpm` });
  if (a.averageCadence !== null && !durationOnly) stats.push({ label: "cadence", value: `${Math.round(a.averageCadence)} spm` });
  if (a.averageWatts !== null) stats.push({ label: "avg power", value: `${Math.round(a.averageWatts)} w` });
  if (a.kilojoules !== null) stats.push({ label: "energy", value: `${Math.round(a.kilojoules)} kj` });
  return stats;
}

export async function loadActivityPage(idStr: string) {
  const row = await loadActivityRow(idStr);
  if (!row) return null;
  // started now so they overlap the photo query
  const liftsPromise = loadActivityLiftWorkouts(row);
  const metricsPromise = loadPublicMetrics(row);

  // public columns only: the exif time/gps (taken_at, gps_*) never leave the db
  const photoRows = await getDb()
    .select({
      blobUrl: activityPhotos.blobUrl,
      width: activityPhotos.width,
      height: activityPhotos.height,
      caption: activityPhotos.caption,
      pinLat: activityPhotos.pinLat,
      pinLng: activityPhotos.pinLng,
    })
    .from(activityPhotos)
    .where(eq(activityPhotos.activityId, row.id))
    .orderBy(asc(activityPhotos.position));

  // everything rendered comes from the public serializer (hide map / hide hr /
  // coarsened start applied there)
  const a = publicActivityDetail(row, photoRows);
  const [lifts, metrics] = await Promise.all([liftsPromise, metricsPromise]);
  const { dateLine, timeLine } = formatLocalDateLine(a.date, a.startTime);
  return {
    row,
    a,
    lifts,
    metrics,
    // hide map → fogEvents is null, so nothing about fog is shown either
    fog: fogLine(a.fogEvents),
    stats: activityStats(a),
    dateLine,
    timeLine,
    icon: sportIcon(a.type),
    sport: sportLabel(a.type),
  };
}

export type ActivityPage = NonNullable<Awaited<ReturnType<typeof loadActivityPage>>>;
