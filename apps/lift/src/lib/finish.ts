// a workout with nothing completed is noise in history and in the server
// sync, so "finish" on one discards it instead.

export type FinishDecision = "finish" | "discard";

export function decideFinish(sets: readonly { completed: boolean | number }[]): FinishDecision {
  return sets.some((s) => Boolean(s.completed)) ? "finish" : "discard";
}
