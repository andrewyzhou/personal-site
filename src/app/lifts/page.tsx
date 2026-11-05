import Link from "next/link";
import type { Metadata } from "next";
import { loadLiftsOverview } from "@/lib/lift/public-stats";
import WeeklyMuscleVolume from "@/components/lift/WeeklyMuscleVolume";
import PrFeed from "@/components/lift/PrFeed";
import RecentLifts from "@/components/lift/RecentLifts";
import StatGrid from "@/components/lift/StatGrid";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "lifts · andrew zhou",
  description: "weight training, set by set: weekly volume per muscle, records, recent workouts.",
};

function SectionHeading({ id, title, note }: { id: string; title: string; note?: string }) {
  return (
    <div style={{ marginBottom: "1rem" }}>
      <h2 id={id} className="font-sans font-semibold text-off-white text-xl">
        {title}
      </h2>
      {note && <p className="font-sans text-gray text-sm">{note}</p>}
    </div>
  );
}

export default async function LiftsPage() {
  const o = await loadLiftsOverview();
  const perWeek = o ? Math.round((o.window.workingSets / Math.max(1, o.window.weeks)) * 10) / 10 : 0;

  return (
    <main className="site-container">
      <section className="py-8">
        <Link href="/" className="font-sans text-gray text-base link-highlight">
          ← home
        </Link>
      </section>

      <section className="py-8">
        <h1 className="font-sans font-bold text-off-white text-6xl" style={{ letterSpacing: "-0.02em", marginBottom: "1rem" }}>
          lifts
        </h1>
        <p className="font-sans text-gray text-lg leading-[1.35] max-w-2xl">
          weight training, set by set. how much each muscle group got each week, the latest records, and recent workouts.
        </p>
      </section>

      <div className="section-divider" />

      {!o ? (
        <section className="py-8">
          <p className="font-sans text-gray text-lg">couldn&apos;t load lifts right now.</p>
        </section>
      ) : (
        <div className="py-8" style={{ maxWidth: "720px" }}>
          <StatGrid
            stats={[
              { label: `workouts · ${o.window.weeks} wk`, value: o.window.workouts.toLocaleString("en-US") },
              { label: `working sets · ${o.window.weeks} wk`, value: o.window.workingSets.toLocaleString("en-US") },
              { label: "sets / week", value: perWeek.toLocaleString("en-US") },
              ...(o.window.tonnage > 0
                ? [{ label: `volume · ${o.window.weeks} wk`, value: `${o.window.tonnage.toLocaleString("en-US")} ${o.unit}` }]
                : []),
            ]}
          />

          <section style={{ margin: "3rem 0" }} aria-labelledby="lifts-volume">
            <SectionHeading id="lifts-volume"                 title="weekly volume"
                note={`working sets per muscle group, last ${o.window.weeks} weeks. secondary muscles count half a set.`}
              />
            {o.window.workouts > 0 ? (
              <WeeklyMuscleVolume overview={o} />
            ) : (
              <p className="font-sans text-gray text-sm">nothing logged in the last {o.window.weeks} weeks.</p>
            )}
          </section>

          <section style={{ margin: "3rem 0" }} aria-labelledby="lifts-prs">
            <SectionHeading id="lifts-prs" title="records" note="newest personal records, against everything logged before." />
            <PrFeed prs={o.prs} today={o.today} />
          </section>

          <section style={{ margin: "3rem 0" }} aria-labelledby="lifts-recent">
            <SectionHeading id="lifts-recent" title="recent workouts" />
            <RecentLifts workouts={o.recent} today={o.today} />
          </section>
        </div>
      )}

      <div className="section-divider" />

      <footer className="py-8 text-center">
        <p className="font-sans text-gray text-sm">© andrew zhou 2025-2026</p>
      </footer>
    </main>
  );
}
