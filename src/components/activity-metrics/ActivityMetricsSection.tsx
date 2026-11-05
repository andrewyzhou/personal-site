"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import type { ActivityMetrics, Split } from "@/lib/metrics/types";
import { PACE_TYPES } from "@/lib/activity-format";
import {
  barFractions,
  bestEffortLabel,
  climbCategoryLabel,
  clock,
  curveGeometry,
  curveValueAt,
  durationLabel,
  effortPaceSPerKm,
  feet,
  formatDist,
  formatElevPair,
  formatGrade,
  formatPaceSPerKm,
  formatSpeedMs,
  isShortSplit,
  splitSpeedMs,
  zoneOpacity,
  zoneSlices,
  CURVE_TICKS_S,
  type DistUnit,
} from "./format";

interface Props {
  metrics: ActivityMetrics | null;
  hrZonesS: number[] | null;
  movingS: number; // the page's published moving time (a.duration)
  elapsedS: number; // the page's published elapsed time (a.elapsedTime)
}

const NUM: CSSProperties = { fontVariantNumeric: "tabular-nums" };
const CELL: CSSProperties = { padding: "0.35rem 0.5rem 0.35rem 0", textAlign: "left", fontWeight: 400, whiteSpace: "nowrap" };
const ROW: CSSProperties = { borderTop: "1px solid var(--theme-divider)" };

function Block({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section style={{ margin: "2rem 0" }} aria-label={title}>
      <div className="flex items-center justify-between" style={{ gap: "0.75rem", marginBottom: "0.5rem" }}>
        <h2 className="font-sans text-gray text-xs">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Bar({ fraction }: { fraction: number }) {
  return (
    <div aria-hidden="true" style={{ height: 4, background: "var(--theme-highlight-bg)", borderRadius: 2 }}>
      <div style={{ width: `${Math.round(fraction * 100)}%`, height: "100%", background: "var(--theme-text-muted)", borderRadius: 2 }} />
    </div>
  );
}

// ---------------------------------------------------------------- headline

// metrics cover only the visible (unfogged) track, so their time and distance
// totals are never shown: moving / elapsed come from the page's published
// totals, and only grade-adjusted pace and effort come from metrics.
function Headline({ m, foot, movingS, elapsedS }: { m: ActivityMetrics | null; foot: boolean; movingS: number; elapsedS: number }) {
  const items: { label: string; value: string }[] = [];
  // moving vs elapsed only when they differ (the stats grid already shows time)
  if (movingS > 0 && elapsedS - movingS >= 60) {
    items.push({ label: "moving time", value: clock(movingS) });
    items.push({ label: "elapsed time", value: clock(elapsedS) });
  }
  if (!m) return items.length ? <HeadlineGrid items={items} /> : null;
  const gap = foot ? formatPaceSPerKm(m.gapSPerKm) : null;
  if (gap) items.push({ label: "grade-adjusted pace", value: gap });
  if (m.effort !== null && Number.isFinite(m.effort)) items.push({ label: "effort", value: String(Math.round(m.effort)) });
  if (items.length === 0) return null;
  return <HeadlineGrid items={items} />;
}

function HeadlineGrid({ items }: { items: { label: string; value: string }[] }) {
  return (
    <div className="grid grid-cols-3 gap-3" style={{ margin: "2rem 0" }}>
      {items.map((s) => (
        <div key={s.label}>
          <p className="font-sans text-off-white text-lg font-medium" style={NUM}>
            {s.value}
          </p>
          <p className="font-sans text-gray text-xs">{s.label}</p>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- splits

function UnitToggle({ unit, onChange }: { unit: DistUnit; onChange: (u: DistUnit) => void }) {
  return (
    <div role="group" aria-label="split unit" className="flex font-sans text-xs" style={{ gap: "0.25rem" }}>
      {(["mi", "km"] as const).map((u) => (
        <button
          key={u}
          type="button"
          aria-pressed={unit === u}
          onClick={() => onChange(u)}
          className={unit === u ? "text-off-white" : "text-gray"}
          style={{
            padding: "0.1rem 0.5rem",
            borderRadius: 4,
            border: "1px solid var(--theme-divider)",
            background: unit === u ? "var(--theme-highlight-bg)" : "transparent",
            cursor: "pointer",
          }}
        >
          {u}
        </button>
      ))}
    </div>
  );
}

function splitRate(s: Split, foot: boolean, unit: DistUnit): string {
  const v = foot ? formatPaceSPerKm(s.paceSPerKm, unit) : formatSpeedMs(splitSpeedMs(s), unit);
  if (v) return v;
  return s.movingS <= 0 ? "stopped" : "—";
}

function Splits({ m, foot }: { m: ActivityMetrics; foot: boolean }) {
  const [unit, setUnit] = useState<DistUnit>("mi");
  const splits = unit === "mi" ? m.splitsMi : m.splitsKm;
  if (m.splitsMi.length === 0 && m.splitsKm.length === 0) return null;
  const showGap = foot && splits.some((s) => s.gapSPerKm !== null);
  const showElev = splits.some((s) => s.elevGainM !== null || s.elevLossM !== null);
  const showHr = splits.some((s) => s.avgHr !== null);
  const bars = barFractions(splits.map(splitSpeedMs));
  const rateLabel = foot ? "pace" : "speed";

  return (
    <Block title="splits" aside={<UnitToggle unit={unit} onChange={setUnit} />}>
      <div style={{ overflowX: "auto" }}>
        <table className="font-sans text-sm" style={{ ...NUM, width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr className="text-gray text-xs">
              <th scope="col" style={CELL}>
                {unit}
              </th>
              <th scope="col" style={CELL}>
                {rateLabel}
              </th>
              <th scope="col" className="hidden sm:table-cell" style={{ ...CELL, width: "30%" }}>
                <span className="sr-only">relative {rateLabel}</span>
              </th>
              {showGap && (
                <th scope="col" style={CELL}>
                  <abbr title="grade-adjusted pace" style={{ textDecoration: "none" }}>
                    adj. pace
                  </abbr>
                </th>
              )}
              {showElev && (
                <th scope="col" style={CELL}>
                  elev
                </th>
              )}
              {showHr && (
                <th scope="col" style={{ ...CELL, paddingRight: 0 }}>
                  hr
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {splits.map((s, i) => (
              <tr key={s.index} style={ROW} title={s.partial ? "includes a fogged stretch" : undefined}>
                <th scope="row" className="text-off-white" style={CELL}>
                  {s.index}
                  {isShortSplit(s, unit) && <span className="text-gray text-xs"> · {formatDist(s.distM, unit)}</span>}
                  {s.partial && <span className="text-gray text-xs"> · partial</span>}
                </th>
                <td className="text-off-white" style={CELL}>
                  {splitRate(s, foot, unit)}
                  <div className="sm:hidden" style={{ marginTop: 3, minWidth: 56 }}>
                    <Bar fraction={bars[i]} />
                  </div>
                </td>
                <td className="hidden sm:table-cell" style={{ ...CELL, verticalAlign: "middle" }}>
                  <Bar fraction={bars[i]} />
                </td>
                {showGap && (
                  <td className="text-secondary" style={CELL}>
                    {formatPaceSPerKm(s.gapSPerKm, unit) ?? "—"}
                  </td>
                )}
                {showElev && (
                  <td className="text-secondary" style={CELL}>
                    {formatElevPair(s.elevGainM, s.elevLossM) ?? "—"}
                  </td>
                )}
                {showHr && (
                  <td className="text-secondary" style={{ ...CELL, paddingRight: 0 }}>
                    {s.avgHr !== null ? Math.round(s.avgHr) : "—"}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Block>
  );
}

// ---------------------------------------------------------------- best efforts

function BestEfforts({ m }: { m: ActivityMetrics }) {
  if (m.bestEfforts.length === 0) return null;
  return (
    <Block title="best efforts">
      <table className="font-sans text-sm" style={{ ...NUM, width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr className="text-gray text-xs">
            <th scope="col" style={CELL}>
              distance
            </th>
            <th scope="col" style={CELL}>
              time
            </th>
            <th scope="col" style={{ ...CELL, paddingRight: 0 }}>
              pace
            </th>
          </tr>
        </thead>
        <tbody>
          {m.bestEfforts.map((e) => (
            <tr key={e.key} style={ROW}>
              <th scope="row" className="text-off-white" style={CELL}>
                {bestEffortLabel(e.key, e.distM)}
              </th>
              <td className="text-off-white" style={CELL}>
                {clock(e.timeS)}
              </td>
              <td className="text-secondary" style={{ ...CELL, paddingRight: 0 }}>
                {formatPaceSPerKm(effortPaceSPerKm(e.distM, e.timeS)) ?? "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Block>
  );
}

// ---------------------------------------------------------------- curves

const CURVE_W = 600;
const CURVE_H = 96;

function Curve({ title, curve, format, noun }: { title: string; curve: { durS: number; value: number }[]; format: (v: number) => string; noun: string }) {
  const g = curveGeometry(curve, CURVE_W, CURVE_H);
  if (!g) return null;
  const readout = CURVE_TICKS_S.map((t) => ({ t, v: curveValueAt(curve, t) })).filter((r) => r.v !== null);
  const aria = `${title}: best average ${noun} for each duration, ${readout.map((r) => `${durationLabel(r.t)} ${format(r.v as number)}`).join(", ")}`;
  return (
    <Block title={title}>
      <p className="font-sans text-gray text-xs" style={{ ...NUM, marginBottom: 6 }}>
        {format(g.yMin)} – {format(g.yMax)}
      </p>
      <div style={{ position: "relative" }}>
        <svg
          viewBox={`0 0 ${CURVE_W} ${CURVE_H}`}
          preserveAspectRatio="none"
          width="100%"
          height={CURVE_H}
          role="img"
          aria-label={aria}
          style={{ display: "block", overflow: "visible" }}
        >
          <line x1={0} x2={CURVE_W} y1={CURVE_H} y2={CURVE_H} stroke="var(--theme-divider)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          {g.ticks.map((t) => (
            <line key={t.label} x1={t.x} x2={t.x} y1={0} y2={CURVE_H} stroke="var(--theme-divider)" strokeWidth={1} strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
          ))}
          <path d={g.path} fill="none" stroke="var(--theme-text-primary)" strokeWidth={1.5} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        </svg>
        <div aria-hidden="true" className="font-sans text-gray text-xs" style={{ position: "relative", height: "1.2em", marginTop: 4 }}>
          {g.ticks.map((t, i) => {
            const pct = (t.x / CURVE_W) * 100;
            const edge = i === g.ticks.length - 1 && pct > 90 ? "translateX(-100%)" : i === 0 && pct < 10 ? "none" : "translateX(-50%)";
            return (
              <span key={t.label} style={{ position: "absolute", left: `${pct}%`, transform: edge, whiteSpace: "nowrap" }}>
                {t.label}
              </span>
            );
          })}
        </div>
      </div>
      {readout.length > 0 && (
        <p className="font-sans text-secondary text-sm" style={{ ...NUM, marginTop: 8 }}>
          {readout.map((r) => `${durationLabel(r.t)} ${format(r.v as number)}`).join(" · ")}
        </p>
      )}
    </Block>
  );
}

// ---------------------------------------------------------------- climbs

function Climbs({ m }: { m: ActivityMetrics }) {
  if (m.climbs.length === 0) return null;
  return (
    <Block title="climbs">
      <div style={{ overflowX: "auto" }}>
        <table className="font-sans text-sm" style={{ ...NUM, width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr className="text-gray text-xs">
              <th scope="col" style={CELL}>
                climb
              </th>
              <th scope="col" style={CELL}>
                distance
              </th>
              <th scope="col" style={CELL}>
                gain
              </th>
              <th scope="col" style={{ ...CELL, paddingRight: 0 }}>
                grade avg / max
              </th>
            </tr>
          </thead>
          <tbody>
            {m.climbs.map((c, i) => {
              const cat = climbCategoryLabel(c.category);
              return (
                <tr key={`${c.startD}-${i}`} style={ROW}>
                  <th scope="row" className="text-off-white" style={CELL}>
                    {i + 1}
                    {cat && <span className="text-gray text-xs"> · {cat}</span>}
                  </th>
                  <td className="text-off-white" style={CELL}>
                    {formatDist(c.distM)}
                  </td>
                  <td className="text-off-white" style={CELL}>
                    {feet(c.gainM)} ft
                  </td>
                  <td className="text-secondary" style={{ ...CELL, paddingRight: 0 }}>
                    {formatGrade(c.avgGradePct)} / {formatGrade(c.maxGradePct)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Block>
  );
}

// ---------------------------------------------------------------- zones

function Zones({ title, zonesS }: { title: string; zonesS: number[] | null }) {
  const slices = zoneSlices(zonesS);
  if (!slices) return null;
  const aria = `${title}: ${slices.map((z) => `${z.label} ${z.minutes} min`).join(", ")}`;
  return (
    <div style={{ marginBottom: "1rem" }}>
      <p className="font-sans text-gray text-xs" style={{ marginBottom: 4 }}>
        {title}
      </p>
      <div role="img" aria-label={aria} className="flex" style={{ height: 10, borderRadius: 3, overflow: "hidden", background: "var(--theme-highlight-bg)" }}>
        {slices.map((z, i) =>
          z.fraction > 0 ? (
            <div
              key={z.label}
              title={`${z.label} · ${z.minutes} min`}
              style={{
                width: `${z.fraction * 100}%`,
                background: `color-mix(in srgb, var(--theme-text-primary) ${Math.round(zoneOpacity(i, slices.length) * 100)}%, transparent)`,
                borderRight: i < slices.length - 1 ? "1px solid var(--theme-bg)" : undefined,
              }}
            />
          ) : null
        )}
      </div>
      <div className="font-sans text-xs" style={{ ...NUM, display: "grid", gridTemplateColumns: `repeat(${slices.length}, minmax(0, 1fr))`, gap: "0.25rem", marginTop: 4 }} aria-hidden="true">
        {slices.map((z) => (
          <div key={z.label}>
            <span className="text-gray">{z.label}</span> <span className="text-secondary">{z.minutes}m</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- section

// per-activity metrics for the public page. everything comes from the public
// serializer (hide hr already applied); each block renders only with data.
export default function ActivityMetricsSection({ metrics, hrZonesS, movingS, elapsedS }: Props) {
  const m = metrics;
  const foot = m ? PACE_TYPES.has(m.sportType) || m.movingPaceSPerKm !== null : false;
  const hasHrZones = zoneSlices(hrZonesS) !== null;
  const hasPaceZones = foot && zoneSlices(m?.paceZonesS) !== null;
  if (!m && !hasHrZones) return null;

  return (
    <div>
      <Headline m={m} foot={foot} movingS={movingS} elapsedS={elapsedS} />
      {m && <Splits m={m} foot={foot} />}
      {m && foot && <BestEfforts m={m} />}
      {m?.powerCurve && <Curve title="power curve" noun="power" curve={m.powerCurve} format={(v) => `${Math.round(v)} w`} />}
      {m?.speedCurve && <Curve title="speed curve" noun="speed" curve={m.speedCurve} format={(v) => formatSpeedMs(v) ?? "—"} />}
      {m && <Climbs m={m} />}
      {(hasHrZones || hasPaceZones) && (
        <Block title="zones">
          {hasHrZones && <Zones title="heart rate" zonesS={hrZonesS} />}
          {hasPaceZones && <Zones title="pace" zonesS={m?.paceZonesS ?? null} />}
        </Block>
      )}
    </div>
  );
}
