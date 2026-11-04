// live pr checks while logging, plus a fallback for the summary list. pure
// (no rn imports) so it runs under vitest. rules follow lift-core history/prs:
// completed working sets only, positive weight and reps, kg comparisons.

import { detectWorkoutPrs, e1rm, isWorkingSet, toKg, type HistorySet, type PrHit, type SetKind, type WeightUnit } from "lift-core";

const EPS = 1e-9;

export type SetPrKind = "e1rm" | "weight" | "reps_at_weight";

/** best values from finished sessions before the current workout */
export interface PriorBests {
  /** finished sessions that logged this exercise; 0 means no prs yet */
  sessions: number;
  e1rmKg: number | null;
  heaviestKg: number | null;
  /** best reps per weight, keyed by kg rounded to 0.01 */
  repsAtWeight: Record<string, number>;
}

export interface PrSet {
  kind: SetKind;
  weight: number | null;
  unit: WeightUnit | null;
  reps: number | null;
}

export const EMPTY_BESTS: PriorBests = { sessions: 0, e1rmKg: null, heaviestKg: null, repsAtWeight: {} };

export function weightKey(kg: number): string {
  return String(Math.round(kg * 100) / 100);
}

/** kg, reps and e1rm of a set that can count toward records, else null */
function measure(set: PrSet): { kg: number; reps: number; est: number | null } | null {
  if (!isWorkingSet(set)) return null;
  if (set.weight === null || !Number.isFinite(set.weight) || set.weight <= 0) return null;
  if (set.reps === null || !Number.isFinite(set.reps) || set.reps <= 0) return null;
  const kg = toKg(set.weight, set.unit ?? "lb");
  return { kg, reps: set.reps, est: e1rm(kg, set.reps) };
}

/** folds one set into the bests (returns a new object) */
export function addToBests(bests: PriorBests, set: PrSet): PriorBests {
  const m = measure(set);
  if (!m) return bests;
  const key = weightKey(m.kg);
  const prevReps = bests.repsAtWeight[key];
  return {
    sessions: bests.sessions,
    e1rmKg: m.est !== null && (bests.e1rmKg === null || m.est > bests.e1rmKg) ? m.est : bests.e1rmKg,
    heaviestKg: bests.heaviestKg === null || m.kg > bests.heaviestKg ? m.kg : bests.heaviestKg,
    repsAtWeight: prevReps === undefined || m.reps > prevReps ? { ...bests.repsAtWeight, [key]: m.reps } : bests.repsAtWeight,
  };
}

/** bests of `exerciseId` from completed sets in workouts other than `excludeWorkoutId` */
export function priorBests(history: readonly HistorySet[], exerciseId: string, excludeWorkoutId?: string): PriorBests {
  let bests: PriorBests = EMPTY_BESTS;
  const sessions = new Set<string>();
  for (const s of history) {
    if (s.exerciseId !== exerciseId || s.workoutId === excludeWorkoutId || !s.completed) continue;
    if (!isWorkingSet(s)) continue;
    sessions.add(s.workoutId);
    bests = addToBests(bests, s);
  }
  return { ...bests, sessions: sessions.size };
}

/** which records this set beats. nothing on an exercise's first session. */
export function setPrKinds(bests: PriorBests, set: PrSet): SetPrKind[] {
  if (bests.sessions === 0) return [];
  const m = measure(set);
  if (!m) return [];
  const out: SetPrKind[] = [];
  // earlier sessions with no load (bodyweight, or reps too high for an e1rm)
  // leave a null best; the first real one beats it, same as detectWorkoutPrs
  if (m.est !== null && (bests.e1rmKg === null || m.est > bests.e1rmKg + EPS)) out.push("e1rm");
  if (bests.heaviestKg === null || m.kg > bests.heaviestKg + EPS) out.push("weight");
  // a new weight is a weight pr, not a rep pr: needs an earlier set at the same load
  const prev = bests.repsAtWeight[weightKey(m.kg)];
  if (prev !== undefined && m.reps > prev) out.push("reps_at_weight");
  return out;
}

/**
 * per-set pr flags for one exercise's sets this session, in logged order.
 * each completed set is compared to history plus the earlier sets, so a
 * repeat of the same pr doesn't badge twice.
 */
export function sessionPrFlags(
  bests: PriorBests,
  sets: readonly (PrSet & { id: string; completed: boolean | number })[]
): Record<string, SetPrKind[]> {
  const out: Record<string, SetPrKind[]> = {};
  let running = bests;
  for (const s of sets) {
    if (!s.completed) continue;
    const kinds = setPrKinds(running, s);
    if (kinds.length) out[s.id] = kinds;
    running = addToBests(running, s);
  }
  return out;
}

/** prior bests per (workout, exercise): history doesn't change mid-workout, so one query each */
export class PriorBestsCache {
  private map = new Map<string, PriorBests>();
  constructor(private load: (exerciseId: string, workoutId: string) => PriorBests) {}

  get(workoutId: string, exerciseId: string): PriorBests {
    const key = `${workoutId}\u0000${exerciseId}`;
    let hit = this.map.get(key);
    if (!hit) {
      try {
        hit = this.load(exerciseId, workoutId);
      } catch {
        // a failed read shouldn't break logging; no badges is the safe answer
        hit = EMPTY_BESTS;
      }
      this.map.set(key, hit);
    }
    return hit;
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}

/** label for a pr kind, lowercase */
export function prKindLabel(kind: PrHit["kind"]): string {
  switch (kind) {
    case "e1rm":
      return "e1rm";
    case "weight":
      return "heaviest";
    case "reps_at_weight":
      return "rep pr";
    case "volume":
      return "volume";
  }
}

/**
 * same contract as lift-core detectWorkoutPrs (skipFirstSession on), for when
 * that one isn't available: one best hit per (exercise, kind).
 */
export function fallbackWorkoutPrs(history: readonly HistorySet[], workoutId: string): PrHit[] {
  const target = history.find((s) => s.workoutId === workoutId);
  if (!target) return [];
  const startedAt = target.startedAt;
  const exerciseIds = [...new Set(history.filter((s) => s.workoutId === workoutId).map((s) => s.exerciseId))];
  const hits: PrHit[] = [];
  for (const exerciseId of exerciseIds) {
    const before = history.filter((s) => s.exerciseId === exerciseId && s.workoutId !== workoutId && s.startedAt < startedAt);
    const bests = priorBests(before, exerciseId);
    if (bests.sessions === 0) continue;
    const mine = history.filter((s) => s.exerciseId === exerciseId && s.workoutId === workoutId && s.completed);
    const best = new Map<SetPrKind, PrHit>();
    for (const s of mine) {
      const m = measure(s);
      if (!m) continue;
      const set = { weight: s.weight as number, unit: s.unit ?? "lb", reps: m.reps };
      for (const kind of setPrKinds(bests, s)) {
        const value = kind === "e1rm" ? (m.est as number) : kind === "weight" ? m.kg : m.reps;
        const previous =
          kind === "e1rm" ? bests.e1rmKg : kind === "weight" ? bests.heaviestKg : (bests.repsAtWeight[weightKey(m.kg)] ?? null);
        const cur = best.get(kind);
        // rep prs: the heaviest load wins a tie on reps gained
        const better =
          !cur ||
          value > cur.value + EPS ||
          (kind === "reps_at_weight" && Math.abs(value - cur.value) <= EPS && m.kg > (cur.atWeightKg ?? 0));
        if (better) {
          best.set(kind, {
            exerciseId,
            kind,
            value,
            previous,
            set,
            ...(kind === "reps_at_weight" ? { atWeightKg: Math.round(m.kg * 100) / 100 } : {}),
          });
        }
      }
    }
    hits.push(...best.values());
    // session volume against the best earlier session
    const volume = (rows: readonly HistorySet[]) => {
      const by = new Map<string, number>();
      for (const s of rows) {
        const m = s.completed ? measure(s) : null;
        if (m && s.unit !== null) by.set(s.workoutId, (by.get(s.workoutId) ?? 0) + m.kg * m.reps);
      }
      return by;
    };
    const mineVol = volume(mine).get(workoutId) ?? 0;
    const prevVol = Math.max(0, ...volume(before).values());
    // no earlier volume is a null best, beatable like the others
    if (mineVol > 0 && mineVol > prevVol + EPS) {
      hits.push({ exerciseId, kind: "volume", value: mineVol, previous: prevVol > 0 ? prevVol : null, set: null });
    }
  }
  return hits;
}

/** lift-core's detector when it works, else the local fallback */
export function workoutPrs(history: readonly HistorySet[], workoutId: string): PrHit[] {
  try {
    return detectWorkoutPrs(history, workoutId);
  } catch {
    return fallbackWorkoutPrs(history, workoutId);
  }
}
