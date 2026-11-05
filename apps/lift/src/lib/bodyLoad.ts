// shading helpers for the body figure, pure so vitest can run them.

import { loadIntensity, type BodyShape, type MuscleRegion } from "lift-core";

/** same rule lift-core uses: 0 only for no load, else ceil into 1..steps */
function fallbackIntensity(load: number | undefined, steps: number): number {
  if (!load || !Number.isFinite(load) || load <= 0) return 0;
  return Math.min(steps, Math.max(1, Math.ceil(Math.min(1, load) * steps)));
}

/** lift-core's step, clamped; falls back locally if it throws or returns junk */
export function intensityOf(load: number | undefined, steps: number): number {
  try {
    const v = loadIntensity(load, steps);
    if (Number.isInteger(v) && v >= 0 && v <= steps) return v;
  } catch {
    // not implemented yet in older lift-core builds
  }
  return fallbackIntensity(load, steps);
}

/** loaded regions, heaviest first */
export function topRegions(load: Partial<Record<MuscleRegion, number>>, n: number): MuscleRegion[] {
  return (Object.entries(load) as [MuscleRegion, number | undefined][])
    .filter((e): e is [MuscleRegion, number] => typeof e[1] === "number" && e[1] > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([r]) => r);
}

/**
 * the load a figure shape shows: the heaviest of the regions it stands for
 * (one deltoid shape covers front + side heads). undefined when none is loaded.
 */
export function shapeLoadOf(
  shape: Pick<BodyShape, "region" | "regions">,
  load: Partial<Record<MuscleRegion, number>>,
): number | undefined {
  const regions = shape.regions?.length ? shape.regions : shape.region ? [shape.region] : [];
  let best: number | undefined;
  for (const r of regions) {
    const v = load[r];
    if (typeof v === "number" && Number.isFinite(v) && (best === undefined || v > best)) best = v;
  }
  return best;
}
