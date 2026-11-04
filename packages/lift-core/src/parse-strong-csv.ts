import type { ParsedWorkout, ParseWarning, WeightUnit } from "./types";

export interface StrongCsvOptions {
  /** unit the export's weight column is in (strong exports in the app's unit setting); default "lb" */
  weightUnit?: WeightUnit;
  /** unit of the distance column; default "mi" */
  distanceUnit?: "mi" | "km";
}

export interface StrongCsvResult {
  /** one per (date, workout name), oldest first; linkSlug is always null */
  workouts: ParsedWorkout[];
  warnings: ParseWarning[];
}

/**
 * parse strong's "export data" csv (comma or semicolon separated, quoted fields,
 * header row with Date, Workout Name, Duration, Exercise Name, Set Order,
 * Weight, Reps, Distance, Seconds, Notes, Workout Notes, RPE). tolerant:
 * unknown columns ignored, bad rows become warnings.
 */
export function parseStrongCsv(text: string, options?: StrongCsvOptions): StrongCsvResult {
  void text;
  void options;
  throw new Error("not implemented");
}
