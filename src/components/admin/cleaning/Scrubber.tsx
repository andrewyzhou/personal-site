"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  areaPath,
  axisTicks,
  bucketSeries,
  fmtOffset,
  hasValues,
  linePath,
  normalizeRange,
  nudge,
  nudgeStep,
  robustRange,
  timeToX,
  xToTime,
  type Range,
} from "@/lib/cleaning/ui-format";
import type { CleaningTrack } from "./api";

export interface ScrubBand extends Range {
  kind: "crop" | "cut" | "suggestion" | "hover";
}

interface Props {
  track: CleaningTrack;
  duration: number;
  selection: Range | null;
  cursorS: number;
  hoverS: number | null;
  bands: ScrubBand[];
  onSelection(r: Range | null): void;
  onCursor(s: number): void;
  onHover(s: number | null): void;
}

const CHART_H = 84;
const AXIS_H = 16;
const DRAG_PX = 3;

const BAND_STYLE: Record<ScrubBand["kind"], React.CSSProperties> = {
  crop: { fill: "var(--theme-text-primary)", opacity: 0.2 },
  cut: { fill: "var(--theme-text-primary)", opacity: 0.2 },
  suggestion: { fill: "var(--theme-text-muted)", opacity: 0.12 },
  hover: { fill: "var(--theme-text-muted)", opacity: 0.3 },
};

// time strip under the map: speed area with hr/elevation lines, drag to
// select, click to place the cursor, arrows nudge it, [ and ] set the
// selection edges at the cursor, esc clears
export default function Scrubber({ track, duration, selection, cursorS, hoverS, bands, onSelection, onCursor, onHover }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const drag = useRef<{ anchorS: number; startX: number; moved: boolean } | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.floor(el.clientWidth)));
    ro.observe(el);
    setWidth(Math.floor(el.clientWidth));
    return () => ro.disconnect();
  }, []);

  const paths = useMemo(() => {
    if (width <= 0) return null;
    const speedB = bucketSeries(track.t, track.speed, duration, width);
    const speedR = robustRange(track.speed);
    const speed = speedR ? areaPath(speedB, CHART_H, speedR[1]) : "";
    const hrR = hasValues(track.hr) ? robustRange(track.hr) : null;
    const hr = hrR ? linePath(bucketSeries(track.t, track.hr, duration, width), CHART_H, hrR[0], hrR[1]) : "";
    const eleR = hasValues(track.ele) ? robustRange(track.ele) : null;
    const ele = eleR ? linePath(bucketSeries(track.t, track.ele, duration, width), CHART_H, eleR[0], eleR[1]) : "";
    return { speed, hr, ele };
  }, [track, duration, width]);

  const ticks = useMemo(() => axisTicks(duration), [duration]);

  const timeAt = (clientX: number) => {
    const el = wrapRef.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    return xToTime(clientX - r.left, r.width, duration);
  };

  function onPointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    drag.current = { anchorS: timeAt(e.clientX), startX: e.clientX, moved: false };
  }
  function onPointerMove(e: React.PointerEvent) {
    const s = timeAt(e.clientX);
    onHover(s);
    const d = drag.current;
    if (!d) return;
    if (!d.moved && Math.abs(e.clientX - d.startX) < DRAG_PX) return;
    d.moved = true;
    onSelection(normalizeRange(d.anchorS, s, duration));
  }
  function onPointerUp(e: React.PointerEvent) {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const s = timeAt(e.clientX);
    if (!d.moved) onSelection(null);
    onCursor(Math.round(s));
  }

  function onKeyDown(e: React.KeyboardEvent) {
    const step = nudgeStep(duration, e.shiftKey);
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      onCursor(nudge(cursorS, e.key === "ArrowLeft" ? -step : step, duration));
    } else if (e.key === "[") {
      onSelection(normalizeRange(cursorS, selection?.toS ?? duration, duration));
    } else if (e.key === "]") {
      onSelection(normalizeRange(selection?.fromS ?? 0, cursorS, duration));
    } else if (e.key === "Escape") {
      onSelection(null);
    } else if (e.key === "Home") {
      e.preventDefault();
      onCursor(0);
    } else if (e.key === "End") {
      e.preventDefault();
      onCursor(Math.round(duration));
    }
  }

  const x = (s: number) => timeToX(s, width, duration);

  return (
    <div className="flex flex-col" style={{ gap: "4px" }}>
      <div
        ref={wrapRef}
        tabIndex={0}
        role="slider"
        aria-label="track time"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(cursorS)}
        aria-valuetext={fmtOffset(cursorS)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (drag.current = null)}
        onPointerLeave={() => {
          if (!drag.current) onHover(null);
        }}
        onKeyDown={onKeyDown}
        className="card-bg rounded-lg"
        style={{ width: "100%", height: CHART_H + AXIS_H, cursor: "crosshair", touchAction: "none", userSelect: "none", overflow: "hidden" }}
      >
        {width > 0 && paths && (
          <svg width={width} height={CHART_H + AXIS_H} style={{ display: "block" }}>
            {bands.map((b, i) => (
              <rect key={i} x={x(b.fromS)} y={0} width={Math.max(1, x(b.toS) - x(b.fromS))} height={CHART_H} style={BAND_STYLE[b.kind]} />
            ))}
            {paths.speed && <path d={paths.speed} style={{ fill: "var(--theme-text-muted)", opacity: 0.35 }} />}
            {paths.ele && <path d={paths.ele} style={{ fill: "none", stroke: "var(--theme-text-muted)", strokeWidth: 1, strokeDasharray: "3 2" }} />}
            {paths.hr && <path d={paths.hr} style={{ fill: "none", stroke: "var(--theme-text-primary)", strokeWidth: 1, opacity: 0.7 }} />}
            {selection && (
              <g>
                <rect x={x(selection.fromS)} y={0} width={Math.max(1, x(selection.toS) - x(selection.fromS))} height={CHART_H} style={{ fill: "var(--theme-text-primary)", opacity: 0.14 }} />
                <line x1={x(selection.fromS)} x2={x(selection.fromS)} y1={0} y2={CHART_H} style={{ stroke: "var(--theme-text-primary)", strokeWidth: 1 }} />
                <line x1={x(selection.toS)} x2={x(selection.toS)} y1={0} y2={CHART_H} style={{ stroke: "var(--theme-text-primary)", strokeWidth: 1 }} />
              </g>
            )}
            {hoverS !== null && (
              <line x1={x(hoverS)} x2={x(hoverS)} y1={0} y2={CHART_H} style={{ stroke: "var(--theme-text-muted)", strokeWidth: 1, strokeDasharray: "2 2" }} />
            )}
            <line x1={x(cursorS)} x2={x(cursorS)} y1={0} y2={CHART_H} style={{ stroke: "var(--theme-text-primary)", strokeWidth: 2 }} />
            <line x1={0} x2={width} y1={CHART_H} y2={CHART_H} style={{ stroke: "var(--theme-divider)", strokeWidth: 1 }} />
            {ticks.map((s) => (
              <text
                key={s}
                x={Math.min(width - 2, Math.max(2, x(s)))}
                y={CHART_H + 12}
                textAnchor={s === 0 ? "start" : x(s) > width - 30 ? "end" : "middle"}
                style={{ fill: "var(--theme-text-muted)", fontSize: 10, fontFamily: "var(--font-sans)" }}
              >
                {fmtOffset(s)}
              </text>
            ))}
          </svg>
        )}
      </div>
      <p className="font-sans text-gray text-xs">
        speed (filled){hasValues(track.hr) ? " · hr (line)" : ""}{hasValues(track.ele) ? " · elevation (dashed)" : ""} — drag to select,
        click to place the cursor, ←/→ nudge (shift for more), [ and ] set the selection at the cursor, esc clears
      </p>
    </div>
  );
}
