// pure display helpers for the per-activity metrics section: unit conversion,
// labels, bar widths and curve axis scaling. metrics store pace in s/km,
// speed in m/s and distances in metres; the site shows imperial by default.

import type { Climb, Split } from "@/lib/metrics/types";
import { fill } from "@/content/site-types";

export type DistUnit = "mi" | "km";

export const M_PER_MI = 1609.344;
export const FT_PER_M = 3.28084;
export const MPH_PER_MS = 2.23694;

const unitM = (unit: DistUnit) => (unit === "mi" ? M_PER_MI : 1000);

const valid = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n);

// "m:ss" (or "h:mm:ss") for a whole number of seconds
export function clock(totalS: number): string {
  const s = Math.round(totalS);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}

// s/km → "7:42 /mi" (or "/km"); null or non-positive → null
export function formatPaceSPerKm(sPerKm: number | null | undefined, unit: DistUnit = "mi"): string | null {
  if (!valid(sPerKm) || sPerKm <= 0) return null;
  const s = (sPerKm * unitM(unit)) / 1000;
  return `${clock(s)} /${unit}`;
}

// m/s → "17.3 mph" (or "km/h")
export function formatSpeedMs(ms: number | null | undefined, unit: DistUnit = "mi"): string | null {
  if (!valid(ms) || ms <= 0) return null;
  return unit === "mi" ? `${(ms * MPH_PER_MS).toFixed(1)} mph` : `${(ms * 3.6).toFixed(1)} km/h`;
}

// metres → "0.42 mi" / "0.68 km"
export function formatDist(m: number, unit: DistUnit = "mi"): string {
  return `${(m / unitM(unit)).toFixed(2)} ${unit}`;
}

export function feet(m: number): number {
  return Math.round(m * FT_PER_M);
}

// split elevation "+42 / −18 ft"; null when the split has no elevation
export function formatElevPair(gainM: number | null, lossM: number | null): string | null {
  if (!valid(gainM) && !valid(lossM)) return null;
  return `+${feet(gainM ?? 0)} / −${feet(lossM ?? 0)} ft`;
}

// a split noticeably shorter than a full unit (the usual last one) shows its distance
export function isShortSplit(split: Pick<Split, "distM">, unit: DistUnit): boolean {
  return split.distM < unitM(unit) * 0.95;
}

// average moving speed for a split in m/s, from pace when present (foot) or
// distance over moving time (rides); null without movement
export function splitSpeedMs(split: Pick<Split, "distM" | "movingS" | "paceSPerKm">): number | null {
  if (valid(split.paceSPerKm) && split.paceSPerKm > 0) return 1000 / split.paceSPerKm;
  if (split.movingS > 0 && split.distM > 0) return split.distM / split.movingS;
  return null;
}

// relative bar widths (0..1) from speeds: proportional to speed against the
// fastest split, so a split 7% slower is a bar 7% shorter (a min–max stretch
// made small differences look huge). at least MIN_BAR so it stays visible;
// null → 0.
export const MIN_BAR = 0.2;
export function barFractions(speeds: (number | null)[]): number[] {
  const vs = speeds.filter(valid).filter((v) => v > 0);
  if (vs.length === 0) return speeds.map(() => 0);
  const hi = Math.max(...vs);
  return speeds.map((v) => (!valid(v) || v <= 0 ? 0 : Math.max(MIN_BAR, v / hi)));
}

// labels come from site.yaml (pages.activity.metrics.bestEfforts.labels),
// keyed by effort key; an unknown key falls back to its distance
export function bestEffortLabel(key: string, distM: number, labels: Readonly<Partial<Record<string, string>>>): string {
  return labels[key] ?? (distM >= 1000 ? `${+(distM / 1000).toFixed(1)} km` : `${Math.round(distM)} m`);
}

// pace for an effort covering distM in timeS
export function effortPaceSPerKm(distM: number, timeS: number): number | null {
  return distM > 0 && timeS > 0 ? (timeS / distM) * 1000 : null;
}

// labels.category is a template, "cat {category}"; labels.hc is used as is
export function climbCategoryLabel(category: Climb["category"], labels: { category: string; hc: string }): string | null {
  if (category === null) return null;
  return category === "hc" ? labels.hc : fill(labels.category, { category });
}

export function formatGrade(pct: number): string {
  return `${pct.toFixed(1)}%`;
}

// ------------------------------------------------------------------ zones

export interface ZoneSlice {
  label: string; // "z1"
  seconds: number;
  fraction: number; // of the total, 0..1
  minutes: number; // whole minutes, rounded
}

// zones with any time; null when there is nothing to show. zoneLabel is a
// template with the 1-based zone number, "z{n}"
export function zoneSlices(zonesS: number[] | null | undefined, zoneLabel: string): ZoneSlice[] | null {
  if (!zonesS || zonesS.length === 0) return null;
  const secs = zonesS.map((s) => (valid(s) && s > 0 ? s : 0));
  const total = secs.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  return secs.map((s, i) => ({ label: fill(zoneLabel, { n: i + 1 }), seconds: s, fraction: s / total, minutes: Math.round(s / 60) }));
}

// zone shading: z1 lightest .. z5 darkest, as an opacity of the text colour
export function zoneOpacity(i: number, count: number): number {
  if (count <= 1) return 0.7;
  return +(0.18 + (0.72 * i) / (count - 1)).toFixed(2);
}

// ------------------------------------------------------------------ curves

export const CURVE_TICKS_S: readonly number[] = [5, 60, 300, 1200, 3600];

export function durationLabel(s: number): string {
  if (s < 60) return `${Math.round(s)} s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  const h = s / 3600;
  return `${Number.isInteger(h) ? h : h.toFixed(1)} h`;
}

// log duration axis: domain [minS, maxS] → [x0, x1]
export function logScale(minS: number, maxS: number, x0: number, x1: number): (s: number) => number {
  const lo = Math.log(Math.max(1, minS));
  const hi = Math.log(Math.max(minS + 1, maxS));
  return (s: number) => x0 + ((Math.log(Math.max(1, s)) - lo) / (hi - lo || 1)) * (x1 - x0);
}

// the standard ticks that fall inside the curve's duration range
export function curveTicks(minS: number, maxS: number): number[] {
  return CURVE_TICKS_S.filter((t) => t >= minS && t <= maxS);
}

export interface CurveGeometry {
  path: string;
  points: { x: number; y: number; durS: number; value: number }[];
  ticks: { x: number; label: string }[];
  yMin: number;
  yMax: number;
}

// svg path for a curve on a log duration axis; value axis linear with a little
// headroom. fewer than two valid points → null.
export function curveGeometry(
  curve: { durS: number; value: number }[] | null | undefined,
  width: number,
  height: number,
  pad = { left: 0, right: 0, top: 4, bottom: 4 }
): CurveGeometry | null {
  const pts = (curve ?? []).filter((p) => valid(p.durS) && p.durS > 0 && valid(p.value) && p.value > 0).sort((a, b) => a.durS - b.durS);
  if (pts.length < 2) return null;
  const minS = pts[0].durS;
  const maxS = pts[pts.length - 1].durS;
  const sx = logScale(minS, maxS, pad.left, width - pad.right);
  const vals = pts.map((p) => p.value);
  const vMax = Math.max(...vals);
  const vMinRaw = Math.min(...vals);
  const span = vMax - vMinRaw || vMax * 0.1 || 1;
  const yMin = Math.max(0, vMinRaw - span * 0.1);
  const yMax = vMax + span * 0.05;
  const top = pad.top;
  const bottom = height - pad.bottom;
  const sy = (v: number) => bottom - ((v - yMin) / (yMax - yMin)) * (bottom - top);
  const points = pts.map((p) => ({ x: +sx(p.durS).toFixed(1), y: +sy(p.value).toFixed(1), durS: p.durS, value: p.value }));
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
  const ticks = curveTicks(minS, maxS).map((t) => ({ x: +sx(t).toFixed(1), label: durationLabel(t) }));
  return { path, points, ticks, yMin, yMax };
}

// curve value nearest a duration (for the "5 s · 1 min · 20 min" readout)
export function curveValueAt(curve: { durS: number; value: number }[], durS: number): number | null {
  const hit = curve.find((p) => p.durS === durS);
  return hit && valid(hit.value) ? hit.value : null;
}
