import type { ParsedWorkout } from "./types";

/** parse a "share workout" text. never throws: problems become warnings. */
export function parseShareText(text: string): ParsedWorkout {
  void text;
  throw new Error("not implemented");
}

/** cheap check used by chat bots to decide whether a message is a workout share */
export function looksLikeShareText(text: string): boolean {
  void text;
  throw new Error("not implemented");
}
