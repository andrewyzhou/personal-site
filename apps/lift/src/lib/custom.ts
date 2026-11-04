// custom exercise rows -> lift-core Exercise, so search and detail treat them
// like catalog entries.

import type { Equipment, Exercise, MuscleRegion, TrackingType } from "lift-core";

export interface CustomExerciseLike {
  id: string;
  name: string;
  equipment: string;
  tracking: string;
  primary: string;
  secondary: string;
}

export const CUSTOM_ID_PREFIX = "custom-";

export function isCustomId(id: string): boolean {
  return id.startsWith(CUSTOM_ID_PREFIX);
}

/** tolerant json-array parse: a corrupt column should not take the picker down */
export function parseRegions(json: string): MuscleRegion[] {
  try {
    const v: unknown = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x): x is MuscleRegion => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function customToExercise(row: CustomExerciseLike): Exercise {
  return {
    id: row.id,
    name: row.name,
    equipment: row.equipment as Equipment,
    category: "other",
    tracking: row.tracking as TrackingType,
    primary: parseRegions(row.primary),
    secondary: parseRegions(row.secondary),
    aliases: [],
    curated: false,
  };
}

export interface CustomUsage {
  workoutExercises: number;
  templateExercises: number;
  /** other customs merged into this one; deleting it would leave their mergedInto dangling */
  mergedFrom: number;
}

export function isCustomInUse(u: CustomUsage): boolean {
  return u.workoutExercises > 0 || u.templateExercises > 0 || u.mergedFrom > 0;
}

/** "3 workout entries and 1 merged exercise" for the in-use prompt */
export function describeCustomUsage(u: CustomUsage): string {
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  return [
    u.workoutExercises ? plural(u.workoutExercises, "workout entry", "workout entries") : "",
    u.templateExercises ? plural(u.templateExercises, "template entry", "template entries") : "",
    u.mergedFrom ? plural(u.mergedFrom, "merged exercise", "merged exercises") : "",
  ]
    .filter(Boolean)
    .join(" and ");
}
