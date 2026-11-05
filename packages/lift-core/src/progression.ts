// progression rules: what to put on the bar next time, from what was lifted
// last time. pure; weights are converted into the caller's unit up front.

import { e1rm, fromKg, toKg } from "./math";
import type { PlannedSetPayload } from "./sync";
import type { SetKind, WeightUnit } from "./types";

export const DEFAULT_INCREMENT: Record<WeightUnit, number> = { lb: 5, kg: 2.5 };
export const DEFAULT_DELOAD_AFTER = 3;
export const DEFAULT_DELOAD_PCT = 10;

interface RuleBase {
  /** step in the caller's unit; default 5 lb / 2.5 kg */
  increment?: number;
  /** consecutive failed sessions before a deload; 0 = never. default 3 */
  deloadAfter?: number;
  /** percent taken off on a deload. default 10 */
  deloadPct?: number;
}

/** add `increment` after a session where every working set hit `reps` */
export interface LinearRule extends RuleBase {
  kind: "linear";
  sets: number;
  reps: number;
}

/** work up from repsLo to repsHi at one weight; when every set hits repsHi, add weight and reset */
export interface DoubleRule extends RuleBase {
  kind: "double";
  sets: number;
  repsLo: number;
  repsHi: number;
}

/** sets at a percentage of the current e1rm, rounded to the increment */
export interface PercentRule {
  kind: "percent";
  sets: number;
  reps: number;
  /** 1..100 */
  percent: number;
  /** rounding step; default 5 lb / 2.5 kg */
  increment?: number;
}

export type ProgressionRule = LinearRule | DoubleRule | PercentRule;
export type ProgressionKind = ProgressionRule["kind"];

/** a logged set as the rules read it; sets table rows fit as-is */
export interface SessionSet {
  kind: SetKind;
  weight: number | null;
  unit: WeightUnit;
  reps: number | null;
  /** 0/1 from sqlite or a boolean; missing counts as done */
  completed?: number | boolean;
}

export type ProgressionAction = "start" | "increase" | "repeat" | "deload" | "percent";

export interface NextTarget {
  /** working sets for next time (no warm-ups) */
  sets: PlannedSetPayload[];
  weight: number | null;
  reps: number;
  unit: WeightUnit;
  action: ProgressionAction;
  /** short why, e.g. "+5 lb: hit 3×5 last time" */
  reason: string;
}

export interface NextTargetOptions {
  /** earlier sessions, newest first, not including lastSessionSets; drives the deload streak */
  history?: readonly (readonly SessionSet[])[];
  /** current e1rm in `unit` for percent rules; else estimated from the sessions given */
  e1rm?: number | null;
  /** weight to start at when there is no history */
  startWeight?: number | null;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** nearest multiple of step (step <= 0 leaves it alone) */
export function roundToIncrement(weight: number, step: number): number {
  if (!(step > 0)) return r3(weight);
  return r3(Math.round(weight / step) * step);
}

function fmt(n: number): string {
  return String(r3(n));
}

/** "190 lb × 5" */
export function formatTarget(t: Pick<NextTarget, "weight" | "reps" | "unit">): string {
  return t.weight != null ? `${fmt(t.weight)} ${t.unit} × ${t.reps}` : `${t.reps} reps`;
}

/** "linear +5 lb · 3×5" for lists */
export function describeRule(rule: ProgressionRule, unit: WeightUnit): string {
  const inc = fmt(rule.increment ?? DEFAULT_INCREMENT[unit]);
  switch (rule.kind) {
    case "linear":
      return `linear +${inc} ${unit} · ${rule.sets}×${rule.reps}`;
    case "double":
      return `double +${inc} ${unit} · ${rule.sets}×${rule.repsLo}-${rule.repsHi}`;
    case "percent":
      return `${fmt(rule.percent)}% e1rm · ${rule.sets}×${rule.reps}`;
  }
}

interface Working {
  weight: number | null;
  reps: number[];
}

const isDone = (s: SessionSet) => s.completed === undefined || Boolean(s.completed);

/** completed non-warm-up sets at the session's top weight, in the caller's unit */
function working(sets: readonly SessionSet[], unit: WeightUnit): Working | null {
  const done = sets.filter((s) => s.kind !== "warmup" && isDone(s) && s.reps != null && s.reps > 0);
  if (!done.length) return null;
  const conv = (s: SessionSet) => (s.weight == null ? null : r3(s.unit === unit ? s.weight : fromKg(toKg(s.weight, s.unit), unit)));
  const weights = done.map(conv).filter((w): w is number => w != null);
  if (!weights.length) return { weight: null, reps: done.map((s) => s.reps!) };
  const top = Math.max(...weights);
  // drop and back-off sets below the top weight aren't the lift being progressed
  return { weight: top, reps: done.filter((s) => conv(s) === top).map((s) => s.reps!) };
}

/** did the session meet the rule (linear: sets×reps; double: sets at repsLo or better) */
function succeeded(rule: LinearRule | DoubleRule, w: Working | null, floor: boolean): boolean {
  if (!w) return false;
  const need = rule.kind === "linear" ? rule.reps : floor ? rule.repsLo : rule.repsHi;
  return w.reps.length >= rule.sets && w.reps.slice(0, rule.sets).every((r) => r >= need);
}

/**
 * failed sessions in a row at the latest weight, newest first. a lighter older
 * session means a deload sat in between, so the count restarts there.
 */
export function failureStreak(
  rule: ProgressionRule,
  sessions: readonly (readonly SessionSet[])[],
  unit: WeightUnit
): number {
  if (rule.kind === "percent") return 0;
  let n = 0;
  let weight: number | null | undefined;
  for (const s of sessions) {
    const w = working(s, unit);
    if (!w) continue;
    if (weight !== undefined && w.weight !== weight) break;
    weight = w.weight;
    if (succeeded(rule, w, true)) break;
    n++;
  }
  return n;
}

function plan(count: number, weight: number | null, reps: number, unit: WeightUnit): PlannedSetPayload[] {
  return Array.from({ length: Math.max(1, count) }, () => ({
    kind: "normal" as const,
    weight,
    unit,
    reps,
    durationS: null,
    distanceM: null,
  }));
}

function bestE1rm(sessions: readonly (readonly SessionSet[])[], unit: WeightUnit): number | null {
  let best: number | null = null;
  for (const s of sessions) {
    for (const set of s) {
      if (set.kind === "warmup" || !isDone(set) || set.weight == null || set.reps == null) continue;
      const kg = e1rm(toKg(set.weight, set.unit), set.reps);
      if (kg != null && (best == null || kg > best)) best = kg;
    }
  }
  return best == null ? null : fromKg(best, unit);
}

/** planned working sets for next time, and why */
export function nextTarget(
  rule: ProgressionRule,
  lastSessionSets: readonly SessionSet[],
  unit: WeightUnit,
  opts: NextTargetOptions = {}
): NextTarget {
  const step = rule.increment != null && rule.increment > 0 ? rule.increment : DEFAULT_INCREMENT[unit];
  const out = (weight: number | null, reps: number, action: ProgressionAction, reason: string): NextTarget => ({
    sets: plan(rule.sets, weight, reps, unit),
    weight,
    reps,
    unit,
    action,
    reason,
  });

  if (rule.kind === "percent") {
    const max = opts.e1rm ?? bestE1rm([lastSessionSets, ...(opts.history ?? [])], unit);
    if (max == null || !(max > 0)) return out(opts.startWeight ?? null, rule.reps, "start", "no e1rm yet: pick a weight");
    const weight = roundToIncrement((max * rule.percent) / 100, step);
    return out(weight, rule.reps, "percent", `${fmt(rule.percent)}% of ${fmt(Math.round(max))} ${unit} e1rm`);
  }

  const firstReps = rule.kind === "linear" ? rule.reps : rule.repsLo;
  const w = working(lastSessionSets, unit);
  if (!w || w.weight == null) {
    const start = opts.startWeight ?? null;
    return out(start, firstReps, "start", start != null ? `start at ${fmt(start)} ${unit}` : "first session: pick a weight");
  }
  const scheme = (reps: number) => `${rule.sets}×${reps}`;

  // linear: target reps on every set; double: the top of the range on every set
  if (succeeded(rule, w, false)) {
    const top = rule.kind === "linear" ? rule.reps : rule.repsHi;
    return out(r3(w.weight + step), firstReps, "increase", `+${fmt(step)} ${unit}: hit ${scheme(top)} last time`);
  }

  if (rule.kind === "double" && succeeded(rule, w, true)) {
    // inside the range: same weight, one more rep than the weakest set
    const low = Math.min(...w.reps.slice(0, rule.sets));
    const reps = Math.max(rule.repsLo, Math.min(rule.repsHi, low + 1));
    return out(w.weight, reps, "repeat", `same weight: build to ${scheme(rule.repsHi)}`);
  }

  const streak = Math.max(1, failureStreak(rule, [lastSessionSets, ...(opts.history ?? [])], unit));
  const after = rule.deloadAfter ?? DEFAULT_DELOAD_AFTER;
  if (after > 0 && streak >= after) {
    const pct = rule.deloadPct ?? DEFAULT_DELOAD_PCT;
    const weight = Math.max(0, roundToIncrement(w.weight * (1 - pct / 100), step));
    return out(weight, firstReps, "deload", `-${fmt(pct)}%: missed ${scheme(firstReps)} ${streak} times`);
  }
  const tail = after > 0 ? ` (${streak} of ${after})` : "";
  return out(w.weight, firstReps, "repeat", `repeat: missed ${scheme(firstReps)}${tail}`);
}

// ---------------------------------------------------------------------------
// tolerant parsing, for rules stored inside program json

const posInt = (v: unknown, max: number): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= max ? v : null;
const posNum = (v: unknown, max: number): number | null =>
  typeof v === "number" && Number.isFinite(v) && v > 0 && v <= max ? v : null;

/** a rule from unknown json, or null when it isn't one */
export function parseRule(v: unknown): ProgressionRule | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  const sets = posInt(o.sets, 50);
  if (sets == null) return null;
  const base: RuleBase = {};
  const inc = posNum(o.increment, 1000);
  if (inc != null) base.increment = inc;
  if (typeof o.deloadAfter === "number" && Number.isInteger(o.deloadAfter) && o.deloadAfter >= 0 && o.deloadAfter <= 50) {
    base.deloadAfter = o.deloadAfter;
  }
  const pct = posNum(o.deloadPct, 90);
  if (pct != null) base.deloadPct = pct;
  switch (o.kind) {
    case "linear": {
      const reps = posInt(o.reps, 100);
      return reps == null ? null : { kind: "linear", sets, reps, ...base };
    }
    case "double": {
      const lo = posInt(o.repsLo, 100);
      const hi = posInt(o.repsHi, 100);
      return lo == null || hi == null || hi < lo ? null : { kind: "double", sets, repsLo: lo, repsHi: hi, ...base };
    }
    case "percent": {
      const reps = posInt(o.reps, 100);
      const percent = posNum(o.percent, 100);
      if (reps == null || percent == null) return null;
      return inc != null ? { kind: "percent", sets, reps, percent, increment: inc } : { kind: "percent", sets, reps, percent };
    }
    default:
      return null;
  }
}

/** a sensible starting rule of each kind, for the picker */
export function defaultRule(kind: ProgressionKind): ProgressionRule {
  switch (kind) {
    case "linear":
      return { kind, sets: 3, reps: 5 };
    case "double":
      return { kind, sets: 3, repsLo: 8, repsHi: 12 };
    case "percent":
      return { kind, sets: 3, reps: 5, percent: 75 };
  }
}
