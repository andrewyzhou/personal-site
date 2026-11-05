import Link from "next/link";
import type { Metadata } from "next";
import { loadPublicRecords } from "@/lib/metrics/records-load";
import { BEST_EFFORT_DISTANCES } from "@/lib/metrics/compute";
import {
  bestEffortLabel,
  clock,
  durationLabel,
  effortPaceSPerKm,
  formatPaceSPerKm,
  formatSpeedMs,
  M_PER_MI,
} from "@/components/activity-metrics/format";
import { fill, getSite, pageTitle, type RecordsPageContent } from "@/content/site";

export const revalidate = 300;

const site = getSite();
const copy = site.pages.records;
const effortLabels = site.pages.activity.metrics.bestEfforts.labels;

export const metadata: Metadata = { title: pageTitle(site, copy.title, copy.section) };

const th = "font-sans text-gray text-xs font-normal text-left";
const td = "font-sans text-off-white text-sm";
const num: React.CSSProperties = { fontVariantNumeric: "tabular-nums", padding: "6px 12px 6px 0", whiteSpace: "nowrap" };

function today(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

// fitness (42-day) and fatigue (7-day) load as two lines, last 180 days
function FitnessChart({ days, copy }: { days: { date: string; fitness: number; fatigue: number }[]; copy: RecordsPageContent }) {
  const W = 680;
  const H = 120;
  const max = Math.max(1, ...days.map((d) => Math.max(d.fitness, d.fatigue)));
  const x = (i: number) => (days.length > 1 ? (i / (days.length - 1)) * W : 0);
  const y = (v: number) => H - 4 - (v / max) * (H - 8);
  const line = (k: "fitness" | "fatigue") => days.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d[k]).toFixed(1)}`).join(" ");
  const last = days[days.length - 1];
  return (
    <figure style={{ margin: 0 }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        preserveAspectRatio="none"
        role="img"
        aria-label={fill(copy.fitnessAria, { fitness: Math.round(last.fitness), fatigue: Math.round(last.fatigue), date: last.date })}
        style={{ display: "block" }}
      >
        <line x1={0} x2={W} y1={H - 4} y2={H - 4} stroke="var(--theme-divider)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        <path d={line("fitness")} fill="none" stroke="var(--theme-text-primary)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        <path d={line("fatigue")} fill="none" stroke="var(--theme-text-muted)" strokeWidth={1} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
      </svg>
      <figcaption className="font-sans text-gray text-xs" style={{ marginTop: 6, fontVariantNumeric: "tabular-nums" }}>
        {fill(copy.fitnessCaption, {
          from: days[0].date,
          to: last.date,
          fitness: Math.round(last.fitness),
          fatigue: Math.round(last.fatigue),
          form: Math.round(last.fitness - last.fatigue),
        })}
      </figcaption>
    </figure>
  );
}

export default async function RecordsPage() {
  const r = await loadPublicRecords(today());
  const efforts = BEST_EFFORT_DISTANCES.map((d) => ({ ...d, rows: r.efforts[d.key] ?? [] })).filter((d) => d.rows.length > 0);
  const empty = efforts.length === 0 && !r.speedCurve.length && !r.powerCurve.length && !r.fitness.length && !r.gear.length;

  return (
    <main className="site-container">
      <section className="py-8">
        <Link href="/" className="font-sans text-gray text-base link-highlight">
          ← {site.nav.home}
        </Link>
      </section>

      <article className="py-8" style={{ maxWidth: "720px" }}>
        <h1 className="font-sans font-bold text-off-white text-4xl" style={{ letterSpacing: "-0.01em", marginBottom: "0.5rem" }}>
          {copy.title}
        </h1>
        <p className="font-sans text-gray text-lg">{copy.intro}</p>
        <hr style={{ border: "none", borderTop: "1px solid var(--theme-divider)", margin: "1.5rem 0" }} />

        {empty && <p className="font-sans text-gray text-base">{copy.empty}</p>}

        {efforts.length > 0 && (
          <section style={{ margin: "2rem 0" }}>
            <h2 className="font-sans text-off-white text-lg font-medium" style={{ marginBottom: "0.75rem" }}>{copy.bestEfforts}</h2>
            <div style={{ overflowX: "auto" }}>
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead>
                  <tr>
                    <th className={th} style={num}>{copy.columns.distance}</th>
                    <th className={th} style={num}>{copy.columns.best}</th>
                    <th className={th} style={num}>{copy.columns.pace}</th>
                    <th className={th} style={num}>{copy.columns.activity}</th>
                    <th className={th} style={num}>{copy.columns.nextBest}</th>
                  </tr>
                </thead>
                <tbody>
                  {efforts.map((d) => {
                    const [best, ...rest] = d.rows;
                    return (
                      <tr key={d.key} style={{ borderTop: "1px solid var(--theme-divider)" }}>
                        <td className={td} style={num}>{bestEffortLabel(d.key, d.distM, effortLabels)}</td>
                        <td className={td} style={num}>{clock(best.timeS)}</td>
                        <td className="font-sans text-gray text-sm" style={num}>{formatPaceSPerKm(effortPaceSPerKm(best.distM, best.timeS))}</td>
                        <td className="font-sans text-sm" style={{ ...num, whiteSpace: "normal" }}>
                          <Link href={`/activities/${best.activityId}`} className="text-secondary link-highlight">{best.name || copy.unnamedActivity}</Link>
                          <span className="text-gray"> · {best.date}</span>
                        </td>
                        <td className="font-sans text-gray text-sm" style={num}>{rest.map((x) => clock(x.timeS)).join(" · ")}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {[
          { title: copy.bestSpeed, rows: r.speedCurve, fmt: (v: number) => formatSpeedMs(v) ?? "" },
          { title: copy.bestPower, rows: r.powerCurve, fmt: (v: number) => `${Math.round(v)} w` },
        ]
          .filter((c) => c.rows.length > 0)
          .map((c) => (
            <section key={c.title} style={{ margin: "2rem 0" }}>
              <h2 className="font-sans text-off-white text-lg font-medium" style={{ marginBottom: "0.75rem" }}>{c.title}</h2>
              <div style={{ overflowX: "auto" }}>
                <table style={{ borderCollapse: "collapse", width: "100%" }}>
                  <thead>
                    <tr>
                      <th className={th} style={num}>{copy.columns.for}</th>
                      <th className={th} style={num}>{copy.columns.best}</th>
                      <th className={th} style={num}>{copy.columns.activity}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.rows.map((p) => (
                      <tr key={p.durS} style={{ borderTop: "1px solid var(--theme-divider)" }}>
                        <td className={td} style={num}>{durationLabel(p.durS)}</td>
                        <td className={td} style={num}>{c.fmt(p.value)}</td>
                        <td className="font-sans text-sm" style={{ ...num, whiteSpace: "normal" }}>
                          <Link href={`/activities/${p.activityId}`} className="text-secondary link-highlight">{p.name || copy.unnamedActivity}</Link>
                          <span className="text-gray"> · {p.date}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}

        {r.fitness.length > 1 && (
          <section style={{ margin: "2rem 0" }}>
            <h2 className="font-sans text-off-white text-lg font-medium" style={{ marginBottom: "0.75rem" }}>{copy.fitness}</h2>
            <FitnessChart days={r.fitness} copy={copy} />
            <p className="font-sans text-gray text-xs" style={{ marginTop: 6 }}>
              {copy.fitnessNote}
            </p>
          </section>
        )}

        {r.gear.length > 0 && (
          <section style={{ margin: "2rem 0" }}>
            <h2 className="font-sans text-off-white text-lg font-medium" style={{ marginBottom: "0.75rem" }}>{copy.gear}</h2>
            <div style={{ overflowX: "auto" }}>
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead>
                  <tr>
                    <th className={th} style={num}>{copy.columns.gear}</th>
                    <th className={th} style={num}>{copy.columns.distance}</th>
                    <th className={th} style={num}>{copy.columns.activities}</th>
                    <th className={th} style={num}>{copy.columns.lastUsed}</th>
                  </tr>
                </thead>
                <tbody>
                  {r.gear.map((g) => (
                    <tr key={g.gear} style={{ borderTop: "1px solid var(--theme-divider)" }}>
                      <td className={td} style={{ ...num, whiteSpace: "normal" }}>
                        {g.gear}
                        {g.alert && <span className="text-gray"> · {copy.gearAlert}</span>}
                      </td>
                      <td className={td} style={num}>{(g.distanceM / M_PER_MI).toFixed(1)} mi</td>
                      <td className="font-sans text-gray text-sm" style={num}>{g.activities}</td>
                      <td className="font-sans text-gray text-sm" style={num}>{g.lastDate}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </article>
    </main>
  );
}
