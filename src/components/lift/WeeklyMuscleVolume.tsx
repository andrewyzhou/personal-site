import type { LiftsOverview, MuscleGroupKey } from "@/lib/lift/public-stats";

// one row per muscle group, one bar per week, all on a shared scale so rows
// compare. plain svg, no client js; each bar's <title> is its tooltip and a
// hidden table carries the same numbers for screen readers.

const mix = (pct: number) => `color-mix(in oklch, var(--theme-text-primary) ${pct}%, transparent)`;
const BAR = mix(55);
const BAR_NOW = mix(90);

const SLOT = 10;
const BAR_W = 7;
const H = 28;

const fmt = (n: number) => (Math.round(n * 10) / 10).toLocaleString("en-US");

export default function WeeklyMuscleVolume({ overview }: { overview: LiftsOverview }) {
  const { weeks, groups, unit } = overview;
  const max = Math.max(1, ...weeks.flatMap((w) => groups.map((g) => w.sets[g.key])));
  const last = weeks.length - 1;
  const avg = (k: MuscleGroupKey) => weeks.reduce((s, w) => s + w.sets[k], 0) / Math.max(1, weeks.length);
  const width = weeks.length * SLOT;

  return (
    <div>
      <div
        className="grid font-sans text-gray text-xs"
        style={{ gridTemplateColumns: "5.5rem 1fr 4.5rem", gap: "0.75rem", marginBottom: "0.25rem" }}
        aria-hidden
      >
        <span />
        <span className="flex justify-between">
          <span>{weeks[0]?.label}</span>
          <span>this week</span>
        </span>
        <span className="text-right">avg / wk</span>
      </div>

      <ul className="flex flex-col" style={{ gap: "0.375rem" }} aria-hidden>
        {groups.map((g) => (
          <li key={g.key} className="grid items-center" style={{ gridTemplateColumns: "5.5rem 1fr 4.5rem", gap: "0.75rem" }}>
            <span className="font-sans text-secondary text-sm">{g.label}</span>
            <svg
              viewBox={`0 0 ${width} ${H}`}
              preserveAspectRatio="none"
              style={{ width: "100%", height: H, display: "block" }}
            >
              <line x1={0} x2={width} y1={H - 0.5} y2={H - 0.5} stroke="var(--theme-divider)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
              {weeks.map((w, i) => {
                const v = w.sets[g.key];
                const h = v > 0 ? Math.max(1.5, (v / max) * (H - 2)) : 0;
                const ton = w.tonnage[g.key];
                const tip = `${i === last ? "this week" : `week of ${w.label}`} · ${g.label}: ${fmt(v)} sets${ton > 0 ? ` · ${ton.toLocaleString("en-US")} ${unit}` : ""}`;
                return (
                  <g key={w.start}>
                    <title>{tip}</title>
                    {/* full-height hit area so thin bars still get a tooltip */}
                    <rect x={i * SLOT} y={0} width={SLOT} height={H} fill="transparent" />
                    {h > 0 && <rect x={i * SLOT + (SLOT - BAR_W) / 2} y={H - h} width={BAR_W} height={h} rx={1} fill={i === last ? BAR_NOW : BAR} />}
                  </g>
                );
              })}
            </svg>
            <span className="font-sans text-off-white text-sm text-right" style={{ fontVariantNumeric: "tabular-nums" }}>
              {fmt(avg(g.key))}
            </span>
          </li>
        ))}
      </ul>

      <table className="sr-only">
        <caption>working sets per muscle group per week (secondary muscles count half)</caption>
        <thead>
          <tr>
            <th scope="col">week of</th>
            {groups.map((g) => (
              <th key={g.key} scope="col">
                {g.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((w) => (
            <tr key={w.start}>
              <th scope="row">{w.label}</th>
              {groups.map((g) => (
                <td key={g.key}>{fmt(w.sets[g.key])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
