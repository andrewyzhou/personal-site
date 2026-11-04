// pure set/ordering logic shared by the repositories and screens.

import type { SetKind, WeightUnit } from "lift-core";

export const DEFAULT_UNIT: WeightUnit = "lb";

export const SET_KINDS: readonly SetKind[] = ["normal", "warmup", "drop", "failure"];

export const KIND_LABEL: Record<SetKind, string> = {
  warmup: "W",
  normal: "N",
  drop: "D",
  failure: "F",
};

/** tap-to-cycle order for the kind toggle */
export function nextKind(kind: SetKind): SetKind {
  const i = SET_KINDS.indexOf(kind);
  return SET_KINDS[(i + 1) % SET_KINDS.length]!;
}

export interface SetValues {
  kind: SetKind;
  weight: number | null;
  unit: WeightUnit;
  reps: number | null;
  durationS: number | null;
  distanceM: number | null;
  rpe: number | null;
}

/**
 * values for a new set. copies load/reps from the previous set of the same
 * exercise in this workout, since the next set is usually the same or close.
 * kind resets to normal unless the previous was a warmup (warmups come in a
 * run before the working sets). rpe is per-set effort, so it never carries.
 */
export function prefillSet(previous: Partial<SetValues> | null | undefined, unit: WeightUnit = DEFAULT_UNIT): SetValues {
  if (!previous) {
    return { kind: "normal", weight: null, unit, reps: null, durationS: null, distanceM: null, rpe: null };
  }
  return {
    kind: previous.kind === "warmup" ? "warmup" : "normal",
    weight: previous.weight ?? null,
    unit: previous.unit ?? unit,
    reps: previous.reps ?? null,
    durationS: previous.durationS ?? null,
    distanceM: previous.distanceM ?? null,
    rpe: null,
  };
}

export interface Positioned {
  position: number;
}

export function byPosition<T extends Positioned>(a: T, b: T): number {
  return a.position - b.position;
}

/** append position: one past the max, so gaps left by deletes don't collide */
export function nextPosition(items: readonly Positioned[]): number {
  let max = -1;
  for (const it of items) if (it.position > max) max = it.position;
  return max + 1;
}

/** last item by position (the "previous set" for prefill) */
export function lastByPosition<T extends Positioned>(items: readonly T[]): T | undefined {
  let best: T | undefined;
  for (const it of items) if (!best || it.position > best.position) best = it;
  return best;
}

/** 1-based display number counting only non-warmup sets, like strong; warmups show "W" */
export function setLabels(sets: readonly { kind: SetKind }[]): string[] {
  let n = 0;
  return sets.map((s) => (s.kind === "warmup" ? KIND_LABEL.warmup : String(++n)));
}
