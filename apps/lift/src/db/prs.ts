// pr reads: prior bests for live badges (cached per workout) and the
// finished-workout pr list for the summary.

import type { PrHit } from "lift-core";
import { loadExerciseHistory, loadHistoryFor } from "./history";
import { PriorBestsCache, priorBests, workoutPrs, type PriorBests } from "../lib/prs";

// finished history can't change under an active workout, so one read per exercise
const cache = new PriorBestsCache((exerciseId, workoutId) => priorBests(loadExerciseHistory(exerciseId), exerciseId, workoutId));

export function getPriorBests(workoutId: string, exerciseId: string): PriorBests {
  return cache.get(workoutId, exerciseId);
}

/** call when a workout closes or history is edited */
export function clearPriorBests(): void {
  cache.clear();
}

/** prs a finished workout set, against everything before it; [] on failure */
export function getWorkoutPrs(workoutId: string, exerciseIds: readonly string[]): PrHit[] {
  try {
    return workoutPrs(loadHistoryFor(exerciseIds), workoutId);
  } catch {
    return [];
  }
}
