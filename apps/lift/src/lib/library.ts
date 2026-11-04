// exercise library logic: which customs are searchable, merged-id lookups,
// browser filter chips, and catalog-name collisions.

import { EXERCISES, resolveExerciseName, type Equipment, type Exercise, type MuscleRegion, type TrackingType } from "lift-core";
import { customToExercise, isCustomId, type CustomExerciseLike } from "./custom";
import { mergeLinkMap, resolveMergedId } from "./merge";

export interface CustomRowLike extends CustomExerciseLike {
  archived: number;
  mergedInto: string | null;
}

/** archived or merged customs stay out of search */
export function isSearchable(row: Pick<CustomRowLike, "archived" | "mergedInto">): boolean {
  return !row.archived && !row.mergedInto;
}

/** built-in catalog plus searchable customs */
export function searchCatalog(builtIn: readonly Exercise[], rows: readonly CustomRowLike[], includeArchived = false): Exercise[] {
  const custom = rows.filter((r) => !r.mergedInto && (includeArchived || !r.archived)).map(customToExercise);
  return [...builtIn, ...custom];
}

export type ExerciseLookup = (id: string) => Exercise | undefined;

/**
 * id -> exercise for display. archived customs still resolve (old workouts use
 * them) and merged ids resolve to whatever they were merged into.
 */
export function buildExerciseLookup(builtIn: readonly Exercise[], rows: readonly CustomRowLike[]): ExerciseLookup {
  const byId = new Map<string, Exercise>();
  for (const e of builtIn) if (!byId.has(e.id)) byId.set(e.id, e);
  for (const r of rows) byId.set(r.id, customToExercise(r));
  const links = mergeLinkMap(rows);
  return (id) => byId.get(resolveMergedId(id, links)) ?? byId.get(id);
}

// ---------------------------------------------------------------------------
// filters

export type ExerciseFilter =
  | { kind: "all" }
  | { kind: "custom" }
  | { kind: "region"; region: MuscleRegion }
  | { kind: "equipment"; equipment: Equipment };

export function matchesFilter(e: Exercise, f: ExerciseFilter): boolean {
  switch (f.kind) {
    case "all":
      return true;
    case "custom":
      return isCustomId(e.id);
    case "region":
      return e.primary.includes(f.region);
    case "equipment":
      return e.equipment === f.equipment;
  }
}

export function filterKey(f: ExerciseFilter): string {
  switch (f.kind) {
    case "region":
      return `region:${f.region}`;
    case "equipment":
      return `equipment:${f.equipment}`;
    default:
      return f.kind;
  }
}

/** equipment actually present in a catalog, most common first, so the chips stay relevant */
export function equipmentInUse(catalog: readonly Exercise[]): Equipment[] {
  const counts = new Map<Equipment, number>();
  for (const e of catalog) counts.set(e.equipment, (counts.get(e.equipment) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k]) => k);
}

export const EQUIPMENT_OPTIONS: readonly Equipment[] = [
  "barbell",
  "dumbbell",
  "machine",
  "cable",
  "smith",
  "ez_bar",
  "kettlebell",
  "band",
  "bodyweight",
  "weighted_bodyweight",
  "assisted_bodyweight",
  "plate",
  "trap_bar",
  "medicine_ball",
  "foam_roll",
  "cardio",
  "other",
];

export const TRACKING_OPTIONS: readonly TrackingType[] = [
  "weight_reps",
  "reps",
  "weighted_bodyweight",
  "assisted_bodyweight",
  "duration",
  "distance_duration",
  "weight_distance",
];

/** toggle a region in one list and keep it out of the other (primary wins over secondary) */
export function toggleRegion(
  list: readonly MuscleRegion[],
  other: readonly MuscleRegion[],
  region: MuscleRegion
): { list: MuscleRegion[]; other: MuscleRegion[] } {
  if (list.includes(region)) return { list: list.filter((r) => r !== region), other: [...other] };
  return { list: [...list, region], other: other.filter((r) => r !== region) };
}

/**
 * built-in exercise a new custom name would resolve to. the site maps imported
 * names the same way, so a custom with this name would split history.
 */
export function catalogCollision(name: string, builtIn: readonly Exercise[] = EXERCISES): Exercise | undefined {
  if (!name.trim()) return undefined;
  return resolveExerciseName(name, builtIn);
}
