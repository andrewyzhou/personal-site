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
