// a workout with nothing completed is noise in history and in the server
// sync, so "finish" on one discards it instead.

export type FinishDecision = "finish" | "discard";

export function decideFinish(sets: readonly { completed: boolean | number }[]): FinishDecision {
  return sets.some((s) => Boolean(s.completed)) ? "finish" : "discard";
}

export interface FinishPlan {
  decision: FinishDecision;
  /** unchecked sets: a finished workout only keeps what was actually done */
  deleteSetIds: string[];
  /** exercises left with no sets after that */
  deleteExerciseIds: string[];
}

/** what finishing does to the rows; a discard keeps everything (soft, recoverable) */
export function planFinish(
  exercises: readonly { id: string; sets: readonly { id: string; completed: boolean | number }[] }[]
): FinishPlan {
  const all = exercises.flatMap((e) => e.sets);
  const decision = decideFinish(all);
  if (decision === "discard") return { decision, deleteSetIds: [], deleteExerciseIds: [] };
  const deleteSetIds: string[] = [];
  const deleteExerciseIds: string[] = [];
  for (const e of exercises) {
    const undone = e.sets.filter((s) => !s.completed);
    deleteSetIds.push(...undone.map((s) => s.id));
    if (undone.length === e.sets.length) deleteExerciseIds.push(e.id);
  }
  return { decision, deleteSetIds, deleteExerciseIds };
}

/** sets that finish would drop, for the confirm copy */
export function countUncompleted(exercises: readonly { sets: readonly { completed: boolean | number }[] }[]): number {
  let n = 0;
  for (const e of exercises) for (const s of e.sets) if (!s.completed) n++;
  return n;
}
