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

/** greedy plate math for a barbell target; target below the bar -> just the bar */
export function platesFor(target: number, unit: WeightUnit, options?: PlateOptions): PlateResult {
  void target;
  void unit;
  void options;
  throw new Error("not implemented");
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

/**
 * warm-up ramp toward a working weight: empty bar x10, then ~40/60/80% with
 * descending reps; skips steps that round to the bar or to the working weight.
 */
export function warmupSets(workingWeight: number, unit: WeightUnit, options?: WarmupOptions): WarmupSet[] {
  void workingWeight;
  void unit;
  void options;
  throw new Error("not implemented");
}
