import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { and, asc, eq } from "drizzle-orm";
import { getDb, activities, activityPhotos, type ActivityRow } from "@/lib/db";
import ActivityMapSection from "@/components/activity-map/ActivityMapSection";
import ActivityPhotoCarousel from "@/components/ActivityPhotoCarousel";
import EngagementSection from "@/components/EngagementSection";
import LiftWorkoutCard from "@/components/lift/LiftWorkoutCard";
import { loadActivityLiftWorkouts } from "@/lib/lift/public";
import ActivityMetricsSection from "@/components/activity-metrics/ActivityMetricsSection";
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

export const revalidate = 300;

async function loadActivity(idStr: string): Promise<ActivityRow | null> {
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

// title only: no description/route/time in metadata
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const row = await loadActivity(id);
  return { title: row ? `${row.name} · activity · andrew zhou` : "activity · andrew zhou" };
}

// "in the fog · 14 min": total hidden time, whole minutes
function fogLine(fogEvents: { durationS: number }[] | null): string | null {
  const totalS = (fogEvents ?? []).reduce((s, e) => s + (Number.isFinite(e.durationS) ? e.durationS : 0), 0);
  const min = Math.round(totalS / 60);
  return min > 0 ? `in the fog · ${min} min` : null;
}

export default async function ActivityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = await loadActivity(id);
  if (!row) notFound();
  // started now so it overlaps the photo query; one indexed lookup when there are no lifts
  const liftsPromise = loadActivityLiftWorkouts(row);
  // public metrics (hide hr applied); null when none are stored or the read fails
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

  // everything rendered below comes from the public serializer (hide map /
  // hide hr / coarsened start applied there)
  const a = publicActivityDetail(row, photoRows);
  const [lifts, metrics] = await Promise.all([liftsPromise, metricsPromise]);
  // hide map → fogEvents is null here, so nothing about fog is shown either
  const fog = fogLine(a.fogEvents);

  const { dateLine, timeLine } = formatLocalDateLine(a.date, a.startTime);
  const durationOnly = DURATION_ONLY_TYPES.has(a.type);

  const stats: { label: string; value: string }[] = [];
  stats.push({ label: "time", value: formatClockDuration(a.duration || a.elapsedTime) });
  if (!durationOnly && a.distance > 100) {
    stats.push({ label: "distance", value: formatMiles(a.distance) });
    if (PACE_TYPES.has(a.type)) {
      stats.push({ label: "avg pace", value: formatPace(a.averageSpeed) });
    } else if (SPEED_TYPES.has(a.type)) {
      stats.push({ label: "avg speed", value: formatMph(a.averageSpeed) });
    }
    if (a.totalElevationGain > 1) stats.push({ label: "elevation", value: formatFeet(a.totalElevationGain) });
  }
  if (a.averageHeartrate !== null) stats.push({ label: "avg hr", value: `${Math.round(a.averageHeartrate)} bpm` });
  if (a.maxHeartrate !== null) stats.push({ label: "max hr", value: `${Math.round(a.maxHeartrate)} bpm` });
  if (a.averageCadence !== null && !durationOnly)
    stats.push({ label: "cadence", value: `${Math.round(a.averageCadence)} spm` });
  if (a.averageWatts !== null) stats.push({ label: "avg power", value: `${Math.round(a.averageWatts)} w` });
  if (a.kilojoules !== null) stats.push({ label: "energy", value: `${Math.round(a.kilojoules)} kj` });

  return (
    <main className="site-container">
      <section className="py-8">
        <Link href="/" className="font-sans text-gray text-base link-highlight">
          ← home
        </Link>
      </section>

      <article className="py-8" style={{ maxWidth: "720px" }}>
        <div className="flex items-center" style={{ gap: "0.75rem", marginBottom: "0.5rem" }}>
          <div
            className="rounded-lg flex items-center justify-center shrink-0"
            style={{ width: "2.5rem", height: "2.5rem", border: "1px solid var(--theme-highlight-bg)" }}
          >
            <Image src={`/icons/activities/${sportIcon(a.type)}.svg`} alt="" width={20} height={20} />
          </div>
          <h1 className="font-sans font-bold text-off-white text-4xl" style={{ letterSpacing: "-0.01em" }}>
            {a.name}
          </h1>
        </div>

        <p className="font-sans text-gray text-lg">
          {dateLine} · {timeLine} · {sportLabel(a.type)}
          {a.gear ? ` · ${a.gear}` : ""}
        </p>

        <hr style={{ border: "none", borderTop: "1px solid var(--theme-divider)", margin: "1.5rem 0" }} />

        {(a.polyline && a.bounds) || fog ? (
          <div style={{ margin: "2rem 0" }}>
            {a.polyline && a.bounds && (
              <ActivityMapSection
                activityId={row.id}
                polyline={a.polyline}
                bounds={a.bounds}
                fogShapes={a.fogShapes}
                photos={a.photos}
                sportType={a.type}
              />
            )}
            {fog && (
              <p className="font-sans text-gray text-sm" style={{ marginTop: a.polyline ? "0.5rem" : 0 }}>
                {fog}
              </p>
            )}
          </div>
        ) : null}

        <div className="grid grid-cols-3 gap-3" style={{ margin: "2rem 0" }}>
          {stats.map((s) => (
            <div key={s.label}>
              <p className="font-sans text-off-white text-lg font-medium">{s.value}</p>
              <p className="font-sans text-gray text-xs">{s.label}</p>
            </div>
          ))}
        </div>

        <ActivityMetricsSection metrics={metrics} hrZonesS={a.hrZonesS} movingS={a.duration} elapsedS={a.elapsedTime} />

        {a.description && (
          <p className="font-sans text-secondary text-base leading-relaxed" style={{ margin: "2rem 0" }}>
            {a.description}
          </p>
        )}

        {lifts.map((w, i) => (
          <LiftWorkoutCard key={`${w.date}:${i}`} workout={w} />
        ))}

        <ActivityPhotoCarousel photos={a.photos} />

        <EngagementSection target={`activity:${row.id}`} />
      </article>

      <div className="section-divider" />

      <footer className="py-8 text-center">
        <p className="font-sans text-gray text-sm">© andrew zhou 2025-2026</p>
      </footer>
    </main>
  );
}
