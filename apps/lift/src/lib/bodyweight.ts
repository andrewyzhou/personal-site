// bodyweight helpers: unit conversion, input parsing, trend line points.

import type { WeightUnit } from "lift-core";

export const LB_PER_KG = 2.20462262185;

export function convertWeight(value: number, from: WeightUnit, to: WeightUnit): number {
  if (from === to) return value;
  return from === "kg" ? value * LB_PER_KG : value / LB_PER_KG;
}

/** kv "unit" value -> unit; anything else falls back to lb */
export function parseUnit(v: string | null | undefined): WeightUnit {
  return v === "kg" ? "kg" : "lb";
}

/** "182.4" / "182,4" -> 182.4; empty, zero, negative or absurd -> null */
export function parseBodyweight(text: string): number | null {
  const t = text.trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$|^\.\d+$/.test(t)) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 0 || n >= 1500) return null;
  return n;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** local "YYYY-MM-DD" */
export function toDateInput(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * local "YYYY-MM-DD" -> epoch ms on that day at now's time of day (so today
 * means right now). invalid dates and dates after today are null.
 */
export function parseDateInput(text: string, now: number): number | null {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ref = new Date(now);
  const out = new Date(y, mo - 1, d, ref.getHours(), ref.getMinutes(), ref.getSeconds(), ref.getMilliseconds());
  if (out.getFullYear() !== y || out.getMonth() !== mo - 1 || out.getDate() !== d) return null;
  if (out.getTime() > now) return null;
  return out.getTime();
}

export function formatWeight(value: number): string {
  return String(Math.round(value * 10) / 10);
}

export interface WeighIn {
  measuredAt: number;
  weight: number;
  unit: WeightUnit;
}

/**
 * svg polyline "x,y x,y" for weigh-ins, oldest left, converted to `unit`.
 * x is by time so gaps read as gaps; a flat series sits mid-height.
 */
export function trendPoints(entries: readonly WeighIn[], unit: WeightUnit, width: number, height: number, pad = 4): string {
  if (entries.length < 2) return "";
  const pts = [...entries]
    .sort((a, b) => a.measuredAt - b.measuredAt)
    .map((e) => ({ t: e.measuredAt, w: convertWeight(e.weight, e.unit, unit) }));
  const t0 = pts[0]!.t;
  const t1 = pts[pts.length - 1]!.t;
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of pts) {
    lo = Math.min(lo, p.w);
    hi = Math.max(hi, p.w);
  }
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  const round = (n: number) => Math.round(n * 10) / 10;
  return pts
    .map((p, i) => {
      const x = t1 === t0 ? (i / (pts.length - 1)) * innerW : ((p.t - t0) / (t1 - t0)) * innerW;
      const y = hi === lo ? innerH / 2 : ((hi - p.w) / (hi - lo)) * innerH;
      return `${round(x + pad)},${round(y + pad)}`;
    })
    .join(" ");
}
