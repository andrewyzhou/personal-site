// exercise detail extras: the best-sets table and the notes timeline. pure.

import { e1rm, isWorkingSet, toKg, type HistorySet, type WeightUnit } from "lift-core";

export interface RankedSet {
  workoutId: string;
  startedAt: number;
  weight: number;
  unit: WeightUnit;
  reps: number;
  e1rmKg: number;
}

/**
 * top `n` completed working sets by e1rm. a repeat of the same load x reps
 * keeps only its first time, so the table isn't five copies of one set.
 */
export function bestSetsByE1rm(history: readonly HistorySet[], exerciseId: string, n = 5): RankedSet[] {
  const seen = new Map<string, RankedSet>();
  for (const s of history) {
    if (s.exerciseId !== exerciseId || !s.completed || !isWorkingSet(s)) continue;
    if (s.weight === null || !(s.weight > 0) || s.reps === null || !(s.reps > 0)) continue;
    const unit = s.unit ?? "lb";
    const kg = toKg(s.weight, unit);
    const est = e1rm(kg, s.reps);
    if (est === null) continue;
    const key = `${Math.round(kg * 100)}x${s.reps}`;
    const prev = seen.get(key);
    if (!prev || s.startedAt < prev.startedAt) {
      seen.set(key, { workoutId: s.workoutId, startedAt: s.startedAt, weight: s.weight, unit, reps: s.reps, e1rmKg: est });
    }
  }
  return [...seen.values()].sort((a, b) => b.e1rmKg - a.e1rmKg || a.startedAt - b.startedAt).slice(0, n);
}

export interface NoteRow {
  workoutId: string;
  startedAt: number;
  exerciseNote: string | null;
  /** set position in the exercise (1-based) and its note */
  setNotes: { setNumber: number; text: string }[];
}

export interface NoteEntry {
  workoutId: string;
  startedAt: number;
  /** "exercise" for the card note, else "set 3" */
  label: string;
  text: string;
}

/** non-empty notes, newest workout first, card note before its set notes */
export function noteTimeline(rows: readonly NoteRow[]): NoteEntry[] {
  const out: NoteEntry[] = [];
  const sorted = [...rows].sort((a, b) => b.startedAt - a.startedAt);
  for (const r of sorted) {
    const card = r.exerciseNote?.trim();
    if (card) out.push({ workoutId: r.workoutId, startedAt: r.startedAt, label: "exercise", text: card });
    for (const s of r.setNotes) {
      const t = s.text.trim();
      if (t) out.push({ workoutId: r.workoutId, startedAt: r.startedAt, label: `set ${s.setNumber}`, text: t });
    }
  }
  return out;
}
