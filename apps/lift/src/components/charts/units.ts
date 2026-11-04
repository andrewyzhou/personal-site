import { fromKg, type WeightUnit } from "lift-core";

/** 102.06 kg -> "225 lb" (lb) / "102.1 kg"; whole numbers drop the decimal */
export function formatKg(kg: number, unit: WeightUnit, digits = 1): string {
  return `${round(fromKg(kg, unit), digits)} ${unit}`;
}

export function round(n: number, digits = 1): string {
  const f = 10 ** digits;
  return String(Math.round(n * f) / f);
}

/** big volumes read better as "12.3k" */
export function formatVolume(kg: number, unit: WeightUnit): string {
  const v = fromKg(kg, unit);
  return v >= 10_000 ? `${round(v / 1000, 1)}k ${unit}` : `${Math.round(v)} ${unit}`;
}

export function formatDay(ms: number): string {
  const d = new Date(ms);
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

/** minutes-only duration for history rows: "1h 05m", "48m" */
export function formatDuration(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60_000));
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${String(m % 60).padStart(2, "0")}m` : `${m}m`;
}
