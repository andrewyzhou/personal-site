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

/** 1-based display number counting only non-warmup sets; warmups show "W" */
export function setLabels(sets: readonly { kind: SetKind }[]): string[] {
  let n = 0;
  return sets.map((s) => (s.kind === "warmup" ? KIND_LABEL.warmup : String(++n)));
}

export function parseUnit(value: string | null | undefined, fallback: WeightUnit = DEFAULT_UNIT): WeightUnit {
  return value === "kg" || value === "lb" ? value : fallback;
}

// rpe 6-10 in half steps: below 6 the scale stops meaning much for strength sets
export const RPE_VALUES: readonly number[] = [6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10];

export function isRpe(n: number | null | undefined): n is number {
  return n != null && RPE_VALUES.includes(n);
}

export function formatRpe(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/**
 * the previous session's set to prefill from / compare against: same position
 * if that session had one, else its last set.
 */
export function pickPrevious<T>(previous: readonly T[], index: number): T | undefined {
  return previous[index] ?? previous[previous.length - 1];
}

/** ghost text for a previous-session set: "185×5", "10 reps", "1:30", "400 m" */
export function formatPrevious(s: {
  weight: number | null;
  reps: number | null;
  durationS: number | null;
  distanceM: number | null;
}): string | null {
  const w = s.weight == null ? "" : String(Math.round(s.weight * 1000) / 1000);
  if (s.reps != null) return w ? `${w}×${s.reps}` : `${s.reps} reps`;
  if (s.durationS != null) {
    const t = Math.max(0, Math.round(s.durationS));
    const time = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
    return w ? `${w}×${time}` : time;
  }
  if (s.distanceM != null) return `${Math.round(s.distanceM * 100) / 100} m`;
  return w || null;
}

// --- exercise order and supersets -------------------------------------------
// lists are in display order. ops return a new list; diffExercises turns that
// into the minimal set of row updates so the outbox only sees real changes.

export interface OrderedExercise {
  id: string;
  position: number;
  supersetGroup: number | null;
}

export interface ExercisePatch {
  id: string;
  position: number;
  supersetGroup: number | null;
}

function nextGroupId(list: readonly OrderedExercise[]): number {
  let max = 0;
  for (const e of list) if (e.supersetGroup != null && e.supersetGroup > max) max = e.supersetGroup;
  return max + 1;
}

/**
 * groups must be contiguous runs of 2+. a lone member loses its group, and a
 * group id that reappears after a gap gets a fresh id for the later run.
 */
export function normalizeGroups<T extends OrderedExercise>(list: readonly T[]): T[] {
  const out = list.map((e) => ({ ...e }));
  const seen = new Set<number>();
  let fresh = nextGroupId(list);
  let i = 0;
  while (i < out.length) {
    const g = out[i]!.supersetGroup;
    let j = i + 1;
    if (g == null) {
      i = j;
      continue;
    }
    while (j < out.length && out[j]!.supersetGroup === g) j++;
    let id: number | null = g;
    if (j - i < 2) id = null;
    else if (seen.has(g)) id = fresh++;
    if (id != null) seen.add(id);
    for (let k = i; k < j; k++) out[k]!.supersetGroup = id;
    i = j;
  }
  return out;
}

/** joins list[i] and list[i+1] (and whatever groups they are already in) */
export function linkWithNext<T extends OrderedExercise>(list: readonly T[], i: number): T[] {
  const a = list[i];
  const b = list[i + 1];
  if (!a || !b) return list.slice();
  const g = a.supersetGroup ?? b.supersetGroup ?? nextGroupId(list);
  const merge = b.supersetGroup;
  const out = list.map((e, k) => {
    if (k === i || k === i + 1) return { ...e, supersetGroup: g };
    if (merge != null && e.supersetGroup === merge) return { ...e, supersetGroup: g };
    return { ...e };
  });
  return normalizeGroups(out);
}

/** splits a group between list[i] and list[i+1] */
export function unlinkFromNext<T extends OrderedExercise>(list: readonly T[], i: number): T[] {
  const a = list[i];
  const b = list[i + 1];
  if (!a || !b || a.supersetGroup == null || a.supersetGroup !== b.supersetGroup) return list.slice();
  const g = a.supersetGroup;
  const fresh = nextGroupId(list);
  const out = list.map((e) => ({ ...e }));
  for (let k = i + 1; k < out.length && out[k]!.supersetGroup === g; k++) out[k]!.supersetGroup = fresh;
  return normalizeGroups(out);
}

function withPositions<T extends OrderedExercise>(before: readonly T[], order: T[]): T[] {
  // reuse the existing positions in sorted order, so a swap touches two rows
  const slots = before.map((e) => e.position).sort((x, y) => x - y);
  return order.map((e, k) => ({ ...e, position: slots[k]! }));
}

/**
 * move up (-1) or down (+1). inside a superset it swaps with its partner; at
 * the group's edge it first steps out of the group in place; an ungrouped
 * exercise hops over a whole neighbouring group so supersets stay intact.
 */
export function moveExercise<T extends OrderedExercise>(list: readonly T[], i: number, dir: -1 | 1): T[] {
  const item = list[i];
  const n = i + dir;
  const neighbor = list[n];
  if (!item || !neighbor) return list.slice();
  const order = list.map((e) => ({ ...e }));
  const g = item.supersetGroup;

  if (g != null && neighbor.supersetGroup !== g) {
    order[i]!.supersetGroup = null;
    return normalizeGroups(order);
  }

  let target = n;
  if (g == null && neighbor.supersetGroup != null) {
    const ng = neighbor.supersetGroup;
    while (order[target + dir]?.supersetGroup === ng) target += dir;
  }
  const [moved] = order.splice(i, 1);
  order.splice(target, 0, moved!);
  return normalizeGroups(withPositions(list, order));
}

export function diffExercises(before: readonly OrderedExercise[], after: readonly OrderedExercise[]): ExercisePatch[] {
  const prev = new Map(before.map((e) => [e.id, e]));
  const out: ExercisePatch[] = [];
  for (const e of after) {
    const p = prev.get(e.id);
    if (!p || p.position !== e.position || p.supersetGroup !== e.supersetGroup) {
      out.push({ id: e.id, position: e.position, supersetGroup: e.supersetGroup });
    }
  }
  return out;
}

export interface GroupEdge {
  grouped: boolean;
  first: boolean;
  last: boolean;
}

/** bracket drawing info per exercise */
export function groupEdges(list: readonly { supersetGroup: number | null }[]): GroupEdge[] {
  return list.map((e, k) => {
    const g = e.supersetGroup;
    if (g == null) return { grouped: false, first: false, last: false };
    return {
      grouped: true,
      first: list[k - 1]?.supersetGroup !== g,
      last: list[k + 1]?.supersetGroup !== g,
    };
  });
}
