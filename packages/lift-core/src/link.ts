import type { ActivityLink, LinkCandidate } from "./types";

/** sport types a watch strength recording can carry */
export const STRENGTH_SPORT_TYPES: readonly string[] = ["WeightTraining", "Workout"];

export interface LinkOptions {
  /** max |start delta| for primary/duplicate matches, minutes (default 20) */
  windowMin?: number;
  /** max gap between the end of a linked recording and the start of a continuation, minutes (default 15) */
  continuationGapMin?: number;
}

/**
 * pick which watch recordings belong to a lifting workout. share text
 * only has a start time, so matching is by start (+-windowMin); split
 * recordings chain on as continuations; a second recording within the window
 * (two devices) is a duplicate. pure: never mutates the candidates.
 */
export function linkWorkoutToActivities(
  workoutLocalStart: string,
  candidates: readonly LinkCandidate[],
  options?: LinkOptions,
): ActivityLink[] {
  void workoutLocalStart;
  void candidates;
  void options;
  throw new Error("not implemented");
}
