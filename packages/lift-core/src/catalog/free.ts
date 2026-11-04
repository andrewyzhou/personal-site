import type { Equipment, Exercise, ExerciseCategory, MuscleRegion, TrackingType } from "../types";
import rawFree from "./free-exercises.json";
import { slugify } from "./curated";

/** slimmed free-exercise-db entry, as written by scripts/build-free-exercises.mjs */
export interface FreeDbEntry {
  id: string;
  name: string;
  equipment: string | null;
  category: string | null;
  force: string | null;
  mechanic: string | null;
  primaryMuscles: string[];
  secondaryMuscles: string[];
}

export const FREE_DB_ENTRIES: readonly FreeDbEntry[] = rawFree as FreeDbEntry[];

const EQUIPMENT: Record<string, Equipment> = {
  "body only": "bodyweight",
  machine: "machine",
  other: "other",
  "foam roll": "foam_roll",
  kettlebells: "kettlebell",
  dumbbell: "dumbbell",
  cable: "cable",
  barbell: "barbell",
  bands: "band",
  "medicine ball": "medicine_ball",
  "exercise ball": "other",
  "e-z curl bar": "ez_bar",
};

const CATEGORY: Record<string, ExerciseCategory> = {
  strength: "strength",
  powerlifting: "strength",
  stretching: "stretching",
  plyometrics: "plyometrics",
  strongman: "strongman",
  cardio: "cardio",
  "olympic weightlifting": "olympic",
};

// upstream has a single "shoulders" group; the name is the only hint for the delt head
function shoulderRegion(name: string): MuscleRegion {
  const n = name.toLowerCase();
  if (/rear|reverse|face pull|back fl/.test(n)) return "rear_delts";
  if (/lateral|side|deltoid raise|upright/.test(n)) return "side_delts";
  return "front_delts";
}

function mapMuscle(muscle: string, name: string): MuscleRegion | null {
  switch (muscle) {
    case "chest":
    case "biceps":
    case "triceps":
    case "forearms":
    case "lats":
    case "traps":
    case "hamstrings":
    case "glutes":
    case "calves":
    case "adductors":
    case "abductors":
    case "neck":
      return muscle;
    case "shoulders":
      return shoulderRegion(name);
    case "middle back":
      return "upper_back";
    case "lower back":
      return "lower_back";
    case "abdominals":
      return "abs";
    case "quadriceps":
      return "quads";
    default:
      return null;
  }
}

function mapMuscles(list: readonly string[], name: string, exclude: readonly MuscleRegion[] = []): MuscleRegion[] {
  const out: MuscleRegion[] = [];
  for (const m of list) {
    const r = mapMuscle(m, name);
    if (r && !out.includes(r) && !exclude.includes(r)) out.push(r);
  }
  return out;
}

function mapEquipment(e: FreeDbEntry): Equipment {
  // upstream files smith machine and trap bar work under machine/other
  if (/smith/i.test(e.name)) return "smith";
  if (/trap bar/i.test(e.name)) return "trap_bar";
  if (e.equipment === null) return "bodyweight";
  return EQUIPMENT[e.equipment] ?? "other";
}

function mapTracking(e: FreeDbEntry, equipment: Equipment, category: ExerciseCategory): TrackingType {
  const n = e.name.toLowerCase();
  if (category === "cardio") return /stair|step mill|rope jumping/.test(n) ? "duration" : "distance_duration";
  if (category === "stretching") return "duration";
  if (/walk|carry|drag|sled push|yoke/.test(n) && category === "strongman") return "weight_distance";
  if (e.force === "static" && equipment === "bodyweight") return "duration";
  if (equipment === "bodyweight") return "reps";
  return "weight_reps";
}

export function freeEntryToExercise(e: FreeDbEntry): Exercise {
  const equipment = mapEquipment(e);
  const category = (e.category && CATEGORY[e.category]) || "other";
  let primary = mapMuscles(e.primaryMuscles, e.name);
  // a handful of upstream stretches list no muscles at all; abs is the least wrong default
  if (primary.length === 0) primary = ["abs"];
  return {
    id: slugify(e.id.replace(/_/g, " ")),
    name: e.name,
    equipment,
    category,
    tracking: mapTracking(e, equipment, category),
    primary,
    secondary: mapMuscles(e.secondaryMuscles, e.name, primary),
    aliases: [],
    freeDbId: e.id,
    curated: false,
  };
}
