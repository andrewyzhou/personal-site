import type { SearchOptions, SearchResult } from "./types";

/** ranked search: exact/aliases -> prefix -> fuzzy -> muscle fallback, with a usage boost */
export function searchExercises(query: string, options?: SearchOptions): SearchResult[] {
  void query;
  void options;
  throw new Error("not implemented");
}
