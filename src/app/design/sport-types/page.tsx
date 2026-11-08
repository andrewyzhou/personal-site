import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { canViewDesignLab } from "../_docs/access";
import {
  FAMILIES,
  GENERIC_ICON,
  SPORT_TYPES,
  SPORT_TYPE_KEYS,
  sportMetric,
  sportTypeIcon,
  type SportFamily,
} from "@/lib/sport-types";
import { FIT_SPORT_RULES, INTERVALS_TYPES } from "@/lib/sport-map";
import ThemeToggle from "./ThemeToggle";

export const metadata: Metadata = {
  title: "sport types · design",
  robots: { index: false, follow: false },
};

// every sport type with its icon, family and upstream sources: the reference
// for how garmin (fit sport/sub_sport) and intervals.icu types land on the site
export default async function SportTypesPage() {
  if (!(await canViewDesignLab())) notFound();

  // reverse map: which fit sport / sub_sport pairs produce each type
  const fitSources = new Map<string, string[]>();
  const add = (type: string, label: string) => fitSources.set(type, [...(fitSources.get(type) ?? []), label]);
  for (const [sport, rule] of Object.entries(FIT_SPORT_RULES)) {
    add(rule.type, sport);
    for (const [sub, type] of Object.entries(rule.sub ?? {})) if (type !== rule.type) add(type, `${sport}/${sub}`);
  }
  const intervals = new Set<string>(INTERVALS_TYPES);
  const families = Object.keys(FAMILIES) as SportFamily[];

  return (
    <main className="sport-types-page" style={{ maxWidth: 1180, margin: "0 auto", padding: "32px 16px 64px" }}>
      <style>{`
        .sport-types-page .st-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 10px; }
        .sport-types-page .st-card { display: flex; gap: 12px; padding: 12px; min-width: 0; }
        .sport-types-page .st-icon { width: 40px; height: 40px; flex: none; display: flex; align-items: center; justify-content: center;
          border: 1px solid var(--theme-highlight-bg); border-radius: 8px; }
        .sport-types-page .st-meta { min-width: 0; overflow-wrap: anywhere; }
        .sport-types-page .st-fam { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 28px; }
        .sport-types-page .st-chip { display: flex; align-items: center; gap: 6px; padding: 6px 10px; }
      `}</style>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 8, flexWrap: "wrap" }}>
        <h1 className="font-sans font-bold text-off-white text-3xl">sport types</h1>
        <ThemeToggle />
      </div>
      <p className="font-sans text-gray text-sm" style={{ marginBottom: 24, maxWidth: 720 }}>
        {SPORT_TYPE_KEYS.length} types in {families.length} families. a device file&apos;s fit sport / sub_sport decides the type;
        without one, intervals.icu&apos;s type does. unknown values fall back to a generic workout ({GENERIC_ICON} icon).
      </p>

      <h2 className="font-sans font-medium text-off-white text-lg" style={{ marginBottom: 10 }}>families (fallback icons)</h2>
      <div className="st-fam">
        {families.map((f) => (
          <div key={f} className="st-chip card-bg rounded-lg" data-family={f}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/icons/activities/${FAMILIES[f].icon}.svg`} alt="" width={18} height={18} />
            <span className="font-sans text-off-white text-sm">{f}</span>
            <span className="font-sans text-gray text-xs">{FAMILIES[f].metric}</span>
          </div>
        ))}
      </div>

      {families.map((f) => {
        const types = SPORT_TYPE_KEYS.filter((k) => SPORT_TYPES[k].family === f);
        if (types.length === 0) return null;
        return (
          <section key={f} style={{ marginBottom: 28 }}>
            <h2 className="font-sans font-medium text-off-white text-lg" style={{ marginBottom: 10 }}>
              {FAMILIES[f].label} <span className="text-gray text-sm">· {types.length}</span>
            </h2>
            <div className="st-grid">
              {types.map((k) => {
                const info = SPORT_TYPES[k];
                const icon = sportTypeIcon(k);
                return (
                  <div key={k} className="st-card card-bg rounded-lg" data-type={k}>
                    <div className="st-icon">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/icons/activities/${icon}.svg`} alt={info.label} width={24} height={24} className="activity-icon" />
                    </div>
                    <div className="st-meta">
                      <div className="font-sans text-off-white text-sm font-medium">{info.label}</div>
                      <div className="font-sans text-gray text-xs">
                        {k} · {sportMetric(k)} · {icon}.svg{intervals.has(k) ? " · intervals" : ""}
                      </div>
                      {fitSources.has(k) && (
                        <div className="font-sans text-gray text-xs" style={{ marginTop: 4 }}>
                          fit: {fitSources.get(k)!.join(", ")}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </main>
  );
}
