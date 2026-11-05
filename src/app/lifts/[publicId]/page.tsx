import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import LiftWorkoutCard, { liftStats } from "@/components/lift/LiftWorkoutCard";
import StatGrid from "@/components/lift/StatGrid";
import { loadLiftOnlyTitle, loadLiftOnlyWorkout } from "@/lib/lift/public";
import { loadLiftsOverview, weekContextLine } from "@/lib/lift/public-stats";
import { formatClockDuration, formatLocalDateLine, sportIcon, sportLabel } from "@/lib/activity-format";

export const revalidate = 300;

// lift-only workouts: ones linked to a recording live on that recording's page
// instead, so this 404s for them (and for deleted/discarded/unknown ids). the
// url segment is the opaque public id; raw workout ids never resolve

export async function generateMetadata({ params }: { params: Promise<{ publicId: string }> }): Promise<Metadata> {
  const { publicId } = await params;
  const title = await loadLiftOnlyTitle(publicId).catch(() => null);
  return { title: title ? `${title} · lift · andrew zhou` : "lift · andrew zhou" };
}

export default async function LiftPage({ params }: { params: Promise<{ publicId: string }> }) {
  const { publicId } = await params;
  // the week line comes from the cached index; started now so it overlaps the workout load
  const overviewPromise = loadLiftsOverview();
  const w = await loadLiftOnlyWorkout(publicId);
  if (!w) notFound();
  const overview = await overviewPromise;
  const week = overview ? weekContextLine(overview, w.date) : null;

  const { dateLine, timeLine } = formatLocalDateLine(w.date, w.startTime ?? "00:00");
  const stats = liftStats(w);
  if (w.durationS) stats.unshift({ label: "time", value: formatClockDuration(w.durationS) });

  return (
    <main className="site-container">
      <section className="py-8">
        <Link href="/lifts" className="font-sans text-gray text-base link-highlight">
          ← lifts
        </Link>
      </section>

      <article className="py-8" style={{ maxWidth: "720px" }}>
        <div className="flex items-center" style={{ gap: "0.75rem", marginBottom: "0.5rem" }}>
          <div
            className="rounded-lg flex items-center justify-center shrink-0"
            style={{ width: "2.5rem", height: "2.5rem", border: "1px solid var(--theme-highlight-bg)" }}
          >
            <Image src={`/icons/activities/${sportIcon("WeightTraining")}.svg`} alt="" width={20} height={20} />
          </div>
          <h1 className="font-sans font-bold text-off-white text-4xl" style={{ letterSpacing: "-0.01em" }}>
            {w.title}
          </h1>
        </div>

        <p className="font-sans text-gray text-lg">
          {dateLine}
          {w.startTime ? ` · ${timeLine}` : ""} · {sportLabel("WeightTraining")}
        </p>

        <hr style={{ border: "none", borderTop: "1px solid var(--theme-divider)", margin: "1.5rem 0" }} />

        <StatGrid stats={stats} />

        {(week || w.prs.length > 0) && (
          <div className="font-sans text-sm" style={{ margin: "-0.75rem 0 2rem" }}>
            {w.prs.length > 0 && (
              <p className="text-secondary">
                new records in {[...new Set(w.prs.map((p) => p.exerciseName))].join(", ")}
              </p>
            )}
            {week && (
              <p className="text-gray">
                {week} ·{" "}
                <Link href="/lifts" className="link-highlight">
                  all lifts
                </Link>
              </p>
            )}
          </div>
        )}

        <LiftWorkoutCard workout={w} title={false} />
      </article>

      <div className="section-divider" />

      <footer className="py-8 text-center">
        <p className="font-sans text-gray text-sm">© andrew zhou 2025-2026</p>
      </footer>
    </main>
  );
}
