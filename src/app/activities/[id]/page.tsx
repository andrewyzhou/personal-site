import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { and, asc, eq } from "drizzle-orm";
import { getDb, activities, activityPhotos, type ActivityRow } from "@/lib/db";
import RouteMap from "@/components/RouteMap";
import ActivityPhotoCarousel from "@/components/ActivityPhotoCarousel";
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
  return rows[0] ?? null;
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const row = await loadActivity(id);
  return { title: row ? `${row.name} · activity · andrew zhou` : "activity · andrew zhou" };
}

export default async function ActivityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = await loadActivity(id);
  if (!row) notFound();

  const photos = await getDb()
    .select({
      url: activityPhotos.blobUrl,
      width: activityPhotos.width,
      height: activityPhotos.height,
      caption: activityPhotos.caption,
    })
    .from(activityPhotos)
    .where(eq(activityPhotos.activityId, row.id))
    .orderBy(asc(activityPhotos.position));

  const { dateLine, timeLine } = formatLocalDateLine(row.localDate, row.localTime);
  const durationOnly = DURATION_ONLY_TYPES.has(row.sportType);

  const stats: { label: string; value: string }[] = [];
  stats.push({ label: "time", value: formatClockDuration(row.movingTimeS || row.elapsedTimeS) });
  if (!durationOnly && row.distanceM > 100) {
    stats.push({ label: "distance", value: formatMiles(row.distanceM) });
    if (PACE_TYPES.has(row.sportType)) {
      stats.push({ label: "avg pace", value: formatPace(row.avgSpeedMs) });
    } else if (SPEED_TYPES.has(row.sportType)) {
      stats.push({ label: "avg speed", value: formatMph(row.avgSpeedMs) });
    }
    if (row.elevGainM > 1) stats.push({ label: "elevation", value: formatFeet(row.elevGainM) });
  }
  if (row.avgHr !== null) stats.push({ label: "avg hr", value: `${Math.round(row.avgHr)} bpm` });
  if (row.maxHr !== null) stats.push({ label: "max hr", value: `${Math.round(row.maxHr)} bpm` });
  if (row.avgCadence !== null && !durationOnly)
    stats.push({ label: "cadence", value: `${Math.round(row.avgCadence)} spm` });
  if (row.avgWatts !== null) stats.push({ label: "avg power", value: `${Math.round(row.avgWatts)} w` });
  if (row.kilojoules !== null) stats.push({ label: "energy", value: `${Math.round(row.kilojoules)} kj` });

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
            <Image src={`/icons/activities/${sportIcon(row.sportType)}.svg`} alt="" width={20} height={20} />
          </div>
          <h1 className="font-sans font-bold text-off-white text-4xl" style={{ letterSpacing: "-0.01em" }}>
            {row.name}
          </h1>
        </div>

        <p className="font-sans text-gray text-lg">
          {dateLine} · {timeLine} · {sportLabel(row.sportType)}
          {row.gear ? ` · ${row.gear}` : ""}
        </p>

        <hr style={{ border: "none", borderTop: "1px solid var(--theme-divider)", margin: "1.5rem 0" }} />

        {row.polyline && row.bounds && (
          <div style={{ margin: "2rem 0" }}>
            <RouteMap polyline={row.polyline} bounds={row.bounds} />
          </div>
        )}

        <div className="grid grid-cols-3 gap-3" style={{ margin: "2rem 0" }}>
          {stats.map((s) => (
            <div key={s.label}>
              <p className="font-sans text-off-white text-lg font-medium">{s.value}</p>
              <p className="font-sans text-gray text-xs">{s.label}</p>
            </div>
          ))}
        </div>

        {row.description && (
          <p className="font-sans text-secondary text-base leading-relaxed" style={{ margin: "2rem 0" }}>
            {row.description}
          </p>
        )}

        <ActivityPhotoCarousel photos={photos} />
      </article>

      <div className="section-divider" />

      <footer className="py-8 text-center">
        <p className="font-sans text-gray text-sm">© andrew zhou 2025-2026</p>
      </footer>
    </main>
  );
}
