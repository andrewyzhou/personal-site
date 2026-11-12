import Link from "next/link";
import * as content from "@/content";
import Hero from "@/components/Hero";
import Currently from "@/components/Currently";
import Contact from "@/components/Contact";
import ErrorBoundary from "@/components/ErrorBoundary";
import Bio from "@/components/mdx/Bio";
import ActivityFigure from "@/components/figure/ActivityFigure";
import HomeSections from "./HomeSections";
import DeployedLine from "./DeployedLine";
import type { HomeData } from "./data";

// the home page, next: the same four hand-composed bands on the same canvas.
// what changes: the tabs go from nine to four, the last band is one figure
// across the full width instead of a graph beside a calendar, and a "latest"
// band appears once there is something to put in it.
export default function HomeA({ data }: { data: HomeData }) {
  const site = content.site();
  return (
    <main className="site-container">
      {/* 1: who */}
      <Hero quotes={data.quotes} />
      <div className="section-divider" />

      {/* 2: about | the sections */}
      <HomeSections bio={<Bio />} roles={data.roles} writing={data.writing} shelves={data.shelves} />
      <div className="section-divider" />

      {/* 3: currently | contact */}
      <section className="py-16">
        <div className="flex flex-col sm:flex-row justify-between gap-12">
          <div className="w-full sm:w-1/2">
            <ErrorBoundary fallback={<p className="font-sans text-gray text-lg">{site.home.errors.currently}</p>}>
              <Currently />
            </ErrorBoundary>
          </div>
          <div className="w-full sm:w-1/2">
            <Contact />
          </div>
        </div>
      </section>
      <div className="section-divider" />

      {/* 4: latest | recently added (only once there is something) */}
      {(data.latest || data.recent.length > 0) && (
        <>
          <section className="py-16">
            <div className="flex flex-col md:flex-row gap-8 md:gap-12">
              <div className="w-full md:w-3/5">
                {data.latest && (
                  <>
                    <h3 className="font-sans font-bold text-off-white text-3xl" style={{ marginBottom: "0.5rem" }}>
                      {site.sectionPages.latest}
                    </h3>
                    <p className="font-sans font-bold text-off-white text-4xl" style={{ letterSpacing: "-0.01em", lineHeight: 1.15 }}>
                      <Link href={data.latest.href} className="link-highlight">
                        {data.latest.title}
                      </Link>
                    </p>
                    <p className="font-sans text-gray text-lg leading-[1.35]" style={{ marginTop: "0.75rem" }}>
                      {data.latest.summary}
                    </p>
                    <p className="font-sans font-semibold text-gray text-lg" style={{ marginTop: "0.5rem" }}>
                      {data.latest.dateLabel}
                    </p>
                  </>
                )}
              </div>
              {data.recent.length > 0 && (
                <div className="w-full md:w-2/5 text-left md:text-right">
                  <h3 className="font-sans font-bold text-off-white text-3xl" style={{ marginBottom: "0.5rem" }}>
                    {site.sectionPages.recent}
                  </h3>
                  <ul className="flex flex-col" style={{ gap: "0.35rem" }}>
                    {data.recent.map((r) => (
                      <li key={`${r.title}:${r.dateLabel}`} className="font-sans text-lg leading-[1.35]">
                        {r.href ? (
                          <Link href={r.href} className="text-off-white link-highlight">
                            {r.title}
                          </Link>
                        ) : (
                          <span className="text-off-white">{r.title}</span>
                        )}
                        <span className="text-gray text-sm block">{r.dateLabel}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </section>
          <div className="section-divider" />
        </>
      )}

      {/* 5: the year */}
      <section className="py-16">
        <ErrorBoundary fallback={<p className="font-sans text-gray text-lg">{site.home.errors.calendar}</p>}>
          <ActivityFigure marks={data.marks} />
        </ErrorBoundary>
        <DeployedLine />
      </section>
      <div className="section-divider" />

      <footer className="py-8 text-center">
        <p className="font-sans text-gray text-sm">{site.site.footer}</p>
      </footer>
    </main>
  );
}
