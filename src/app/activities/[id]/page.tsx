import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import ActivityMapSection from "@/components/activity-map/ActivityMapSection";
import ActivityPhotoCarousel from "@/components/ActivityPhotoCarousel";
import EngagementSection from "@/components/EngagementSection";
import LiftWorkoutCard from "@/components/lift/LiftWorkoutCard";
import ActivityMetricsSection from "@/components/activity-metrics/ActivityMetricsSection";
import { getSite } from "@/content/site";
import { loadActivityPage, loadActivityRow } from "@/content/activity";

export const revalidate = 300;

// title only: no description/route/time in metadata
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const row = await loadActivityRow(id);
  return { title: row ? `${row.name} · activity · andrew zhou` : "activity · andrew zhou" };
}

export default async function ActivityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const page = await loadActivityPage(id);
  if (!page) notFound();
  const { row, a, lifts, metrics, fog, stats, dateLine, timeLine } = page;

  return (
    <main className="site-container">
      <section className="py-8">
        <Link href="/" className="font-sans text-gray text-base link-highlight">
          ← home
        </Link>
        <span className="font-sans text-gray text-base"> · </span>
        <Link href="/activities/records" className="font-sans text-gray text-base link-highlight">
          {getSite().pages.records.link}
        </Link>
      </section>

      <article className="py-8" style={{ maxWidth: "720px" }}>
        <div className="flex items-center" style={{ gap: "0.75rem", marginBottom: "0.5rem" }}>
          <div
            className="rounded-lg flex items-center justify-center shrink-0"
            style={{ width: "2.5rem", height: "2.5rem", border: "1px solid var(--theme-highlight-bg)" }}
          >
            <Image src={`/icons/activities/${page.icon}.svg`} alt="" width={20} height={20} />
          </div>
          <h1 className="font-sans font-bold text-off-white text-4xl" style={{ letterSpacing: "-0.01em" }}>
            {a.name}
          </h1>
        </div>

        <p className="font-sans text-gray text-lg">
          {dateLine} · {timeLine} · {page.sport}
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
