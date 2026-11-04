import type { Exercise } from "../types";

/** built-in catalog: curated entries first, then the remaining free-exercise-db entries */
export const EXERCISES: readonly Exercise[] = [];

export function getExercise(id: string, catalog: readonly Exercise[] = EXERCISES): Exercise | undefined {
  void id;
  void catalog;
  throw new Error("not implemented");
}

/** lowercase, strip punctuation/parens, collapse whitespace: the key used for exact/alias matching */
export function normalizeName(name: string): string {
  void name;
  throw new Error("not implemented");
}

/** exact canonical-name or alias match (after normalizeName); used by the share-text ingest */
export function resolveExerciseName(name: string, catalog: readonly Exercise[] = EXERCISES): Exercise | undefined {
  void name;
  void catalog;
  throw new Error("not implemented");
}
