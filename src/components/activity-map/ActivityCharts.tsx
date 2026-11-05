"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReplayData } from "@/lib/replay/build";
import {
  buildReplayView,
  chartX,
  formatDistance,
  formatElapsed,
  formatMetric,
  indexAtTime,
  linearScale,
  nearestSorted,
  seriesArea,
  seriesExtent,
  seriesPath,
  speedMetricFor,
  type MapMetric,
} from "@/lib/replay/metrics-view";

interface ActivityChartsProps {
  replay: ReplayData;
  sportType: string;
  hoverT: number | null;
  onHoverT?: (t: number | null) => void;
}

const PANEL_H = 64;
const GAP = 14;
const LABEL_H = 14;

interface Panel {
  key: string;
  label: string;
  metric: MapMetric;
  values: (number | null)[];
  extent: [number, number];
  area: boolean;
}

// elevation profile + pace/speed + hr as plain svg, synced with the map:
// pointer (or a finger) over the chart sets hoverT, hoverT from the map moves
// the cursor. series with no data are left out.
export default function ActivityCharts({ replay, sportType, hoverT, onHoverT }: ActivityChartsProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver((entries) => setWidth(Math.round(entries[0].contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const view = useMemo(() => buildReplayView(replay), [replay]);
  const xs = useMemo(() => chartX(view), [view]);
  const byDistance = xs === view.dist;
  const speedMetric = speedMetricFor(sportType);

  const panels = useMemo(() => {
    const out: Panel[] = [];
    const add = (key: string, label: string, metric: MapMetric, values: (number | null)[], area: boolean, robust: boolean) => {
      const extent = seriesExtent(values, 0.08, robust);
      if (extent) out.push({ key, label, metric, values, extent, area });
    };
    if (view.hasEle) add("ele", "elevation", "elevation", view.ele, true, false);
    if (view.n > 1) add("speed", speedMetric, speedMetric, view.speed, false, true);
    if (view.hasHr) add("hr", "heart rate", "hr", view.hr, false, true);
    return out;
  }, [view, speedMetric]);

  const height = panels.length * (PANEL_H + LABEL_H) + Math.max(0, panels.length - 1) * GAP;
  const xDomain: [number, number] = [xs[0] ?? 0, xs[xs.length - 1] ?? 1];
  const sx = linearScale(xDomain, [0, Math.max(1, width)]);

  const drawn = useMemo(() => {
    if (width <= 0) return [];
    const sxw = linearScale(xDomain, [0, width]);
    return panels.map((p, k) => {
      const top = k * (PANEL_H + LABEL_H + GAP) + LABEL_H;
      const syRaw = linearScale(p.extent, [top + PANEL_H, top]);
      const sy = (v: number) => syRaw(Math.max(p.extent[0], Math.min(p.extent[1], v)));
      const d = p.area ? seriesArea(view, p.values, sxw, sy, top + PANEL_H, width) : seriesPath(view, p.values, sxw, sy, width);
      return { ...p, top, sy, d };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panels, view, width, xDomain[0], xDomain[1]]);

  if (panels.length === 0) return null;

  const hi = hoverT !== null && view.n > 0 ? indexAtTime(view, hoverT) : -1;
  const cx = hi >= 0 ? sx(xs[hi]) : null;

  const scrub = (clientX: number, rect: DOMRect) => {
    if (!onHoverT || view.n === 0 || width <= 0) return;
    const f = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const x = xDomain[0] + f * (xDomain[1] - xDomain[0]);
    onHoverT(view.t[nearestSorted(xs, x)]);
  };

  const readout =
    hi >= 0
      ? [
          byDistance ? formatDistance(view.dist[hi]) : formatElapsed(view.t[hi]),
          ...panels.map((p) => formatMetric(p.values[hi], p.metric)),
        ]
      : null;

  return (
    <div ref={wrapRef} style={{ margin: "1rem 0 0", userSelect: "none" }}>
      <p className="font-sans text-gray text-xs" style={{ minHeight: "1.2em", marginBottom: 4, fontVariantNumeric: "tabular-nums" }}>
        {readout ? readout.join(" · ") : byDistance ? formatDistance(view.totalDist) : formatElapsed(view.totalS)}
      </p>
      <div style={{ height }}>
        {width > 0 && (
          <svg
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label="elevation, pace and heart rate along the route"
            style={{ display: "block", touchAction: "pan-y", cursor: "crosshair", overflow: "visible" }}
            onPointerDown={(e) => {
              if (e.pointerType !== "mouse") e.currentTarget.setPointerCapture(e.pointerId);
              scrub(e.clientX, e.currentTarget.getBoundingClientRect());
            }}
            onPointerMove={(e) => scrub(e.clientX, e.currentTarget.getBoundingClientRect())}
            onPointerLeave={(e) => {
              if (e.pointerType === "mouse") onHoverT?.(null);
            }}
            onPointerCancel={() => onHoverT?.(null)}
          >
            {drawn.map((p) => (
              <g key={p.key}>
                <text x={0} y={p.top - 4} fontSize={11} fill="var(--theme-text-muted)" className="font-sans">
                  {p.label}
                  <tspan fill="var(--theme-text-muted)" opacity={0.7}>
                    {"  "}
                    {formatMetric(p.extent[0], p.metric)} – {formatMetric(p.extent[1], p.metric)}
                  </tspan>
                </text>
                <line x1={0} x2={width} y1={p.top + PANEL_H} y2={p.top + PANEL_H} stroke="var(--theme-divider)" strokeWidth={1} />
                {p.area ? (
                  <path d={p.d} fill="var(--theme-text-muted)" fillOpacity={0.22} stroke="var(--theme-text-muted)" strokeWidth={1} />
                ) : (
                  <path d={p.d} fill="none" stroke="var(--theme-text-primary)" strokeWidth={1.25} strokeLinejoin="round" />
                )}
                {cx !== null && p.values[hi] !== null && (
                  <circle cx={cx} cy={p.sy(p.values[hi] as number)} r={3} fill="var(--theme-text-primary)" stroke="var(--theme-bg)" strokeWidth={1.5} />
                )}
              </g>
            ))}
            {cx !== null && (
              <line x1={cx} x2={cx} y1={LABEL_H} y2={height} stroke="var(--theme-text-primary)" strokeOpacity={0.5} strokeWidth={1} pointerEvents="none" />
            )}
          </svg>
        )}
      </div>
    </div>
  );
}
