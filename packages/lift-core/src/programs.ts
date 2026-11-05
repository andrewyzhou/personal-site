// training programs: ordered weeks of days, each day a template, plus an
// optional progression rule per template exercise. pure and json-serializable:
// ProgramData is what the phone stores (as text) and the server keeps (jsonb).

import { parseRule, type ProgressionRule } from "./progression";

export const PROGRAM_DATA_VERSION = 1;
export const MAX_PROGRAM_WEEKS = 52;
export const MAX_PROGRAM_DAYS_PER_WEEK = 14;
/** serialized size cap; well past any real program, well under a push's body cap */
export const MAX_PROGRAM_DATA_LENGTH = 100_000;
const MAX_SKIPPED = 10_000;

export interface ProgramDay {
  /** template to run; null = rest day, skipped by progress */
  templateId: string | null;
}

export interface ProgramWeek {
  days: ProgramDay[];
}

export interface ProgramData {
  version: typeof PROGRAM_DATA_VERSION;
  weeks: ProgramWeek[];
  /** template_exercises id -> rule */
  rules: Record<string, ProgressionRule>;
  /** epoch ms; workouts before this don't count. null = not started yet, so nothing counts */
  startedAt: number | null;
  /** position at startedAt: days done or skipped before it, so "skip" doesn't need a fake workout */
  skipped: number;
  /** start over after the last week instead of finishing */
  repeat: boolean;
}

export function emptyProgram(weeks = 1, daysPerWeek = 3): ProgramData {
  return {
    version: PROGRAM_DATA_VERSION,
    weeks: Array.from({ length: weeks }, () => ({ days: Array.from({ length: daysPerWeek }, () => ({ templateId: null })) })),
    rules: {},
    startedAt: null,
    skipped: 0,
    repeat: false,
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** why `v` isn't a valid ProgramData, or null. strict: used by the server validator */
export function checkProgramData(v: unknown): string | null {
  if (!isObj(v)) return "must be an object";
  if (v.version !== PROGRAM_DATA_VERSION) return `version must be ${PROGRAM_DATA_VERSION}`;
  if (!Array.isArray(v.weeks)) return "weeks must be an array";
  if (v.weeks.length > MAX_PROGRAM_WEEKS) return `at most ${MAX_PROGRAM_WEEKS} weeks`;
  for (const [i, w] of v.weeks.entries()) {
    if (!isObj(w) || !Array.isArray(w.days)) return `weeks[${i}].days must be an array`;
    if (w.days.length > MAX_PROGRAM_DAYS_PER_WEEK) return `weeks[${i}] has more than ${MAX_PROGRAM_DAYS_PER_WEEK} days`;
    for (const [j, d] of w.days.entries()) {
      if (!isObj(d)) return `weeks[${i}].days[${j}] must be an object`;
      const t = d.templateId;
      if (t !== null && (typeof t !== "string" || t.length < 1 || t.length > 128)) {
        return `weeks[${i}].days[${j}].templateId must be an id or null`;
      }
    }
  }
  if (!isObj(v.rules)) return "rules must be an object";
  for (const [k, r] of Object.entries(v.rules)) {
    if (k.length < 1 || k.length > 128) return "rules keys must be ids";
    if (!parseRule(r)) return `rules.${k} is not a valid rule`;
    const unit = (r as Record<string, unknown>).unit;
    if (unit !== undefined && unit !== "lb" && unit !== "kg") return `rules.${k}.unit must be lb or kg`;
  }
  if (v.startedAt !== null && (typeof v.startedAt !== "number" || !Number.isSafeInteger(v.startedAt) || v.startedAt < 0)) {
    return "startedAt must be epoch ms or null";
  }
  if (typeof v.skipped !== "number" || !Number.isInteger(v.skipped) || v.skipped < 0 || v.skipped > MAX_SKIPPED) {
    return "skipped must be a non-negative integer";
  }
  if (typeof v.repeat !== "boolean") return "repeat must be a boolean";
  return null;
}

/**
 * why stored program text isn't valid, or null. the server validator and the
 * phone's save both call this, so a program the phone keeps always syncs.
 */
export function checkProgramText(v: unknown): string | null {
  if (typeof v !== "string") return "must be a json string";
  if (v.length > MAX_PROGRAM_DATA_LENGTH) return `length must be at most ${MAX_PROGRAM_DATA_LENGTH}`;
  let parsed: unknown;
  try {
    parsed = JSON.parse(v);
  } catch {
    return "is not valid json";
  }
  return checkProgramData(parsed);
}

/** tolerant parse of stored program json: bad parts fall back, never throws */
export function parseProgramData(json: string | null | undefined): ProgramData {
  let raw: unknown;
  try {
    raw = json ? JSON.parse(json) : null;
  } catch {
    raw = null;
  }
  const out = emptyProgram(0);
  if (!isObj(raw)) return out;
  if (Array.isArray(raw.weeks)) {
    out.weeks = raw.weeks.slice(0, MAX_PROGRAM_WEEKS).map((w) => ({
      days: (isObj(w) && Array.isArray(w.days) ? w.days : []).slice(0, MAX_PROGRAM_DAYS_PER_WEEK).map((d) => ({
        templateId: isObj(d) && typeof d.templateId === "string" && d.templateId ? d.templateId : null,
      })),
    }));
  }
  if (isObj(raw.rules)) {
    for (const [k, r] of Object.entries(raw.rules)) {
      const rule = parseRule(r);
      if (rule) out.rules[k] = rule;
    }
  }
  if (typeof raw.startedAt === "number" && Number.isSafeInteger(raw.startedAt) && raw.startedAt >= 0) out.startedAt = raw.startedAt;
  if (typeof raw.skipped === "number" && Number.isInteger(raw.skipped) && raw.skipped >= 0) out.skipped = Math.min(raw.skipped, MAX_SKIPPED);
  out.repeat = raw.repeat === true;
  return out;
}

/** stable key order, so an unchanged program serializes to the same text */
export function serializeProgramData(p: ProgramData): string {
  const rules: Record<string, ProgressionRule> = {};
  for (const k of Object.keys(p.rules).sort()) rules[k] = p.rules[k]!;
  return JSON.stringify({
    version: PROGRAM_DATA_VERSION,
    weeks: p.weeks.map((w) => ({ days: w.days.map((d) => ({ templateId: d.templateId })) })),
    rules,
    startedAt: p.startedAt,
    skipped: p.skipped,
    repeat: p.repeat,
  });
}

// ---------------------------------------------------------------------------
// progress

export interface ProgramSlot {
  /** 0-based */
  week: number;
  /** 0-based, within the week (rest days count toward the index) */
  day: number;
  templateId: string;
}

/** a finished workout, as progress reads it */
export interface CompletedWorkout {
  templateId: string | null;
  /** epoch ms */
  startedAt: number;
}

export interface ProgramProgress {
  /** the slot to do next; null when finished (or the program has no days) */
  next: ProgramSlot | null;
  /** 0-based week/day of `next`, or of the end when finished */
  week: number;
  day: number;
  /** training days done in the current pass (skips included) */
  completed: number;
  /** training days in one pass */
  total: number;
  /** 0..1 through the current pass */
  fraction: number;
  done: boolean;
  /** finished passes, for repeating programs */
  cycles: number;
}

/** training days in order, rest days dropped */
export function programSlots(p: Pick<ProgramData, "weeks">): ProgramSlot[] {
  const out: ProgramSlot[] = [];
  p.weeks.forEach((w, week) =>
    w.days.forEach((d, day) => {
      if (d.templateId) out.push({ week, day, templateId: d.templateId });
    })
  );
  return out;
}

/**
 * training days done or skipped, across passes. workouts count in time order
 * from startedAt, each one only when it ran the next expected template, so an
 * off-program session (or a template done twice) doesn't move it forward.
 */
function programPosition(program: ProgramData, slots: readonly ProgramSlot[], completedWorkouts: readonly CompletedWorkout[]): number {
  const total = slots.length;
  let pos = program.skipped;
  // not started: no workout counts yet, only skips
  if (program.startedAt == null || !total) return pos;
  const since = program.startedAt;
  const ordered = completedWorkouts
    .filter((w) => w.templateId && w.startedAt >= since)
    .sort((a, b) => a.startedAt - b.startedAt);
  for (const w of ordered) {
    if (!program.repeat && pos >= total) break;
    if (slots[pos % total]!.templateId === w.templateId) pos++;
  }
  return pos;
}

/** where the program stands */
export function programProgress(program: ProgramData, completedWorkouts: readonly CompletedWorkout[]): ProgramProgress {
  const slots = programSlots(program);
  const total = slots.length;
  if (!total) return { next: null, week: 0, day: 0, completed: 0, total: 0, fraction: 0, done: true, cycles: 0 };
  const pos = programPosition(program, slots, completedWorkouts);
  if (!program.repeat && pos >= total) {
    const last = slots[total - 1]!;
    return { next: null, week: last.week, day: last.day, completed: total, total, fraction: 1, done: true, cycles: 1 };
  }
  const cycles = Math.floor(pos / total);
  const inPass = pos % total;
  const next = slots[inPass]!;
  return {
    next,
    week: next.week,
    day: next.day,
    completed: inPass,
    total,
    fraction: inPass / total,
    done: false,
    cycles,
  };
}

/**
 * the program after skipping its next day. a started program is rebased: the
 * position so far becomes `skipped` and counting restarts at `now`, so the
 * workouts already matched aren't replayed against a shifted schedule.
 */
export function skipNextDay(program: ProgramData, completedWorkouts: readonly CompletedWorkout[], now: number): ProgramData {
  const slots = programSlots(program);
  const total = slots.length;
  if (!total) return program;
  const pos = programPosition(program, slots, completedWorkouts);
  if (!program.repeat && pos >= total) return program;
  let skipped = pos + 1;
  // a long-running repeat keeps its place in the pass; only the lap count is dropped
  if (skipped > MAX_SKIPPED) skipped %= total;
  return program.startedAt == null ? { ...program, skipped } : { ...program, startedAt: now, skipped };
}

/** "week 2 · day 1" */
export function formatSlot(s: { week: number; day: number }): string {
  return `week ${s.week + 1} · day ${s.day + 1}`;
}

/** template ids the program references, deduped in order */
export function programTemplateIds(p: Pick<ProgramData, "weeks">): string[] {
  return [...new Set(programSlots(p).map((s) => s.templateId))];
}
