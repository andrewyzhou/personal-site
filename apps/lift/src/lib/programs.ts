// pure program logic for the app: grid edits, progression-adjusted plans and
// the per-exercise hint. no expo imports so it runs under vitest.

import {
  checkProgramData,
  emptyProgram,
  formatTarget,
  nextTarget,
  type DoubleRule,
  type NextTarget,
  type ProgramData,
  type ProgressionRule,
  type SessionSet,
  type WeightUnit,
} from "lift-core";
import type { PlannedSet } from "./templates";

// ---------------------------------------------------------------------------
// grid edits (all return a new ProgramData)

export const MAX_WEEKS = 52;
export const MAX_DAYS = 14;

export function daysPerWeek(p: ProgramData): number {
  return Math.max(0, ...p.weeks.map((w) => w.days.length));
}

/** new week at the end, copying the last one: most programs repeat a pattern */
export function addWeek(p: ProgramData): ProgramData {
  if (p.weeks.length >= MAX_WEEKS) return p;
  const last = p.weeks[p.weeks.length - 1];
  const days = last ? last.days.map((d) => ({ ...d })) : [{ templateId: null }];
  return { ...p, weeks: [...p.weeks, { days }] };
}

export function removeWeek(p: ProgramData, index: number): ProgramData {
  if (index < 0 || index >= p.weeks.length) return p;
  return { ...p, weeks: p.weeks.filter((_, i) => i !== index) };
}

/** every week gets exactly n days: new ones are rest days, extra ones are cut */
export function setDayCount(p: ProgramData, n: number): ProgramData {
  const count = Math.max(1, Math.min(MAX_DAYS, Math.round(n)));
  return {
    ...p,
    weeks: p.weeks.map((w) => ({
      days: Array.from({ length: count }, (_, i) => (w.days[i] ? { ...w.days[i]! } : { templateId: null })),
    })),
  };
}

export function setDay(p: ProgramData, week: number, day: number, templateId: string | null): ProgramData {
  if (!p.weeks[week] || day < 0 || day >= MAX_DAYS) return p;
  return {
    ...p,
    weeks: p.weeks.map((w, i) => {
      if (i !== week) return w;
      const days = w.days.map((d) => ({ ...d }));
      while (days.length <= day) days.push({ templateId: null });
      days[day] = { templateId };
      return { days };
    }),
  };
}

export function setRule(p: ProgramData, templateExerciseId: string, rule: ProgressionRule | null): ProgramData {
  const rules = { ...p.rules };
  if (rule) rules[templateExerciseId] = rule;
  else delete rules[templateExerciseId];
  return { ...p, rules };
}

export const MAX_RULE_SETS = 50;
export const MAX_RULE_REPS = 100;
export const MAX_RULE_INCREMENT = 1000;

/** a whole number in 1..max; a blank or zero field keeps the last good value */
export function ruleInt(v: number | null, fallback: number, max: number): number {
  return v != null && v >= 1 ? Math.min(max, Math.round(v)) : fallback;
}

/** rep range edits that keep lo <= hi: raising the bottom past the top drags the top along */
export function withRepRange(rule: DoubleRule, lo: number | null, hi: number | null): DoubleRule {
  const repsLo = ruleInt(lo, rule.repsLo, MAX_RULE_REPS);
  const repsHi = Math.max(repsLo, ruleInt(hi, rule.repsHi, MAX_RULE_REPS));
  return { ...rule, repsLo, repsHi };
}

/** why the server would refuse this rule, or null: the same check sync runs */
export function ruleProblem(rule: ProgressionRule): string | null {
  const why = checkProgramData({ ...emptyProgram(0), rules: { rule } });
  if (!why) return null;
  const msg = why.replace(/^rules\.rule\.?\s?/, "");
  return msg.startsWith("is not") ? "this rule won't save: check its numbers" : msg;
}

/** drops rules for template exercises that no longer exist */
export function pruneRules(p: ProgramData, keep: ReadonlySet<string>): ProgramData {
  const rules: ProgramData["rules"] = {};
  for (const [k, r] of Object.entries(p.rules)) if (keep.has(k)) rules[k] = r;
  return { ...p, rules };
}

// ---------------------------------------------------------------------------
// progression on top of a template

export interface TemplateExerciseRef {
  id: string;
  exerciseId: string;
}

/** the rule for an exercise of the workout's template: first template entry with that exercise */
export function ruleFor(
  rules: ProgramData["rules"],
  templateExercises: readonly TemplateExerciseRef[],
  exerciseId: string
): ProgressionRule | null {
  for (const te of templateExercises) if (te.exerciseId === exerciseId && rules[te.id]) return rules[te.id]!;
  return null;
}

/**
 * the template's plan with the working sets replaced by the target. warm-ups
 * stay as planned; a target with no weight yet (first session) keeps the plan.
 */
export function plannedWithTarget(planned: readonly PlannedSet[], target: NextTarget | null): PlannedSet[] {
  if (!target || target.weight == null) return [...planned];
  const warmups = planned.filter((s) => s.kind === "warmup");
  return [...warmups, ...target.sets];
}

/** what the rule says for today, from the finished sessions (newest first) */
export function targetFromHistory(rule: ProgressionRule, sessions: readonly (readonly SessionSet[])[], unit: WeightUnit): NextTarget {
  const [last = [], ...older] = sessions;
  return nextTarget(rule, last, unit, { history: older });
}

/**
 * hint under an exercise on the workout screen. while working sets are still
 * open it says today's target; once they're all checked, what next time is.
 */
export function progressionHint(
  rule: ProgressionRule,
  current: readonly SessionSet[],
  history: readonly (readonly SessionSet[])[],
  unit: WeightUnit
): string {
  const working = current.filter((s) => s.kind !== "warmup");
  const allDone = working.length > 0 && working.every((s) => Boolean(s.completed));
  if (allDone) {
    const next = nextTarget(rule, working, unit, { history });
    return next.weight == null ? `next: ${next.reason}` : `next: ${formatTarget(next)}`;
  }
  const today = targetFromHistory(rule, history, unit);
  return today.weight == null ? `today: ${today.reason}` : `today: ${formatTarget(today)} · ${today.reason}`;
}

/** progress line for lists: "week 2 · day 1 · 4/12" */
export function progressLabel(p: { done: boolean; week: number; day: number; completed: number; total: number; cycles: number }): string {
  if (!p.total) return "no training days yet";
  if (p.done) return `finished · ${p.total}/${p.total}`;
  const lap = p.cycles > 0 ? ` · round ${p.cycles + 1}` : "";
  return `week ${p.week + 1} · day ${p.day + 1} · ${p.completed}/${p.total}${lap}`;
}
