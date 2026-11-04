import type { WeightUnit } from "./types";

export interface PlateOptions {
  /** bar weight in `unit` (default 45 lb / 20 kg) */
  bar?: number;
  /** available plate sizes per side, any order (default lb: 45,35,25,10,5,2.5; kg: 25,20,15,10,5,2.5,1.25) */
  plates?: readonly number[];
  /** max pairs per plate size, default unlimited */
  inventory?: Readonly<Record<number, number>>;
}

export interface PlateResult {
  unit: WeightUnit;
  bar: number;
  /** plates for ONE side, heaviest first */
  perSide: number[];
  /** what the bar actually weighs with those plates */
  achieved: number;
  /** target - achieved (>= 0); 0 when exact */
  remainder: number;
}

const DEFAULT_BAR: Record<WeightUnit, number> = { lb: 45, kg: 20 };
const DEFAULT_PLATES: Record<WeightUnit, readonly number[]> = {
  lb: [45, 35, 25, 10, 5, 2.5],
  kg: [25, 20, 15, 10, 5, 2.5, 1.25],
};
const DEFAULT_INCREMENT: Record<WeightUnit, number> = { lb: 5, kg: 2.5 };

// all plate math runs in integer thousandths so 2.5 and 1.25 never drift
const SCALE = 1000;
const toMilli = (x: number) => Math.round(x * SCALE);
const fromMilli = (x: number) => x / SCALE;

/** greedy plate math for a barbell target; target below the bar -> just the bar */
export function platesFor(target: number, unit: WeightUnit, options?: PlateOptions): PlateResult {
  const bar = options?.bar ?? DEFAULT_BAR[unit];
  const inventory = options?.inventory;
  const sizes = [...new Set((options?.plates ?? DEFAULT_PLATES[unit]).filter((p) => Number.isFinite(p) && p > 0))].sort(
    (a, b) => b - a,
  );

  const barM = toMilli(bar);
  const targetM = Number.isFinite(target) ? toMilli(target) : barM;
  const perSide: number[] = [];
  let sideLeft = targetM > barM ? Math.floor((targetM - barM) / 2) : 0;

  for (const size of sizes) {
    const sizeM = toMilli(size);
    const cap = inventory?.[size];
    let count = Math.floor(sideLeft / sizeM);
    if (cap !== undefined) count = Math.min(count, Math.max(0, Math.floor(cap)));
    for (let i = 0; i < count; i++) perSide.push(size);
    sideLeft -= count * sizeM;
  }

  const achievedM = barM + 2 * perSide.reduce((sum, p) => sum + toMilli(p), 0);
  return {
    unit,
    bar,
    perSide,
    achieved: fromMilli(achievedM),
    remainder: fromMilli(Math.max(0, targetM - achievedM)),
  };
}

export interface WarmupSet {
  weight: number;
  reps: number;
  /** fraction of the working weight, e.g. 0.5 */
  pct: number;
}

export interface WarmupOptions {
  bar?: number;
  /** rounding increment in `unit` (default 5 lb / 2.5 kg) */
  increment?: number;
}

const RAMP: readonly { pct: number; reps: number }[] = [
  { pct: 0.4, reps: 5 },
  { pct: 0.6, reps: 3 },
  { pct: 0.8, reps: 2 },
];

/**
 * warm-up ramp toward a working weight: empty bar x10, then ~40/60/80% with
 * descending reps; skips steps that round to the bar or to the working weight.
 * the bar set's pct is its real fraction; ramp steps report the nominal one.
 * a working weight at or below the bar gets no warm-ups.
 */
export function warmupSets(workingWeight: number, unit: WeightUnit, options?: WarmupOptions): WarmupSet[] {
  const bar = options?.bar ?? DEFAULT_BAR[unit];
  const rawIncrement = options?.increment ?? DEFAULT_INCREMENT[unit];
  const incM = toMilli(rawIncrement > 0 ? rawIncrement : DEFAULT_INCREMENT[unit]);
  if (!Number.isFinite(workingWeight)) return [];
  const workM = toMilli(workingWeight);
  const barM = toMilli(bar);
  if (workM <= barM) return [];

  const out: WarmupSet[] = [{ weight: bar, reps: 10, pct: Math.round((bar / workingWeight) * 100) / 100 }];
  let lastM = barM;
  for (const step of RAMP) {
    const wM = Math.round((workM * step.pct) / incM) * incM;
    // never repeat or go backwards, and never reach the working weight itself
    if (wM <= lastM || wM >= workM) continue;
    out.push({ weight: fromMilli(wM), reps: step.reps, pct: step.pct });
    lastM = wM;
  }
  return out;
}
