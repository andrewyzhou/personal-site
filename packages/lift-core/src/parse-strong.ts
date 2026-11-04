import type { ParsedWorkout } from "./types";

/** parse strong's "share workout" text. never throws: problems become warnings. */
export function parseStrongText(text: string): ParsedWorkout {
  void text;
  throw new Error("not implemented");
}

/** cheap check used by chat bots to decide whether a message is a strong share */
export function looksLikeStrongText(text: string): boolean {
  void text;
  throw new Error("not implemented");
}
