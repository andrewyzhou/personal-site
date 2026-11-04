import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import LiftWorkoutCard, { liftStats } from "@/components/lift/LiftWorkoutCard";
import { loadLiftOnlyTitle, loadLiftOnlyWorkout } from "@/lib/lift/public";
import { formatClockDuration, formatLocalDateLine, sportIcon, sportLabel } from "@/lib/activity-format";

export const revalidate = 300;

// lift-only workouts: ones linked to a recording live on that recording's page
// instead, so this 404s for them (and for deleted/discarded/unknown ids)

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const title = await loadLiftOnlyTitle(id).catch(() => null);
  return { title: title ? `${title} · lift · andrew zhou` : "lift · andrew zhou" };
}

export default async function LiftPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const w = await loadLiftOnlyWorkout(id);
  if (!w) notFound();

  const { dateLine, timeLine } = formatLocalDateLine(w.date, w.startTime ?? "00:00");
  const stats = liftStats(w);
  if (w.durationS) stats.unshift({ label: "time", value: formatClockDuration(w.durationS) });

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

        <div className="grid grid-cols-3 gap-3" style={{ margin: "2rem 0" }}>
          {stats.map((s) => (
            <div key={s.label}>
              <p className="font-sans text-off-white text-lg font-medium">{s.value}</p>
              <p className="font-sans text-gray text-xs">{s.label}</p>
            </div>
          ))}
        </div>

        <LiftWorkoutCard workout={w} title={false} />
      </article>

      <div className="section-divider" />

      <footer className="py-8 text-center">
        <p className="font-sans text-gray text-sm">© andrew zhou 2025-2026</p>
      </footer>
    </main>
  );
}
