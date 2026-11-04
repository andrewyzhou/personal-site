// shared types for lift-core. pure data only: no react, no node built-ins, no dom.

export type WeightUnit = "lb" | "kg";
export type DistanceUnit = "m" | "km" | "mi" | "ft" | "yd";

// warmup = strong's "W" sets; drop/failure come from strong's set tags
export type SetKind = "warmup" | "normal" | "drop" | "failure";

// ---------------------------------------------------------------------------
// strong share-text parser output

export interface ParsedSet {
  /** 0-based position within the exercise, warm-ups included, in text order */
  position: number;
  kind: SetKind;
  /** "Set 3" -> 3, "W2" -> 2, bare "W" -> null */
  label: number | null;
  /**
   * load in `unit`. for weighted bodyweight sets ("+25 lb") this is the added
   * load; for assisted sets ("-40 lb") it is negative. null when no load given.
   */
  weight: number | null;
  unit: WeightUnit | null;
  reps: number | null;
  durationS: number | null;
  distance: number | null;
  distanceUnit: DistanceUnit | null;
  rpe: number | null;
  /** true when the load is relative to bodyweight (+/- prefix) or the set is reps-only */
  bodyweight: boolean;
  /** free text found on the set line that wasn't understood (tags, notes) */
  note: string | null;
  /** the original line, trimmed */
  raw: string;
}

export interface ParsedExercise {
  /** exercise name exactly as strong printed it, e.g. "Bench Press (Barbell)" */
  name: string;
  sets: ParsedSet[];
  notes: string[];
}

export interface ParseWarning {
  /** 1-based line number in the input */
  line: number;
  message: string;
  text: string;
}

export interface ParsedWorkout {
  title: string;
  /**
   * local wall-clock start, "YYYY-MM-DDTHH:MM" (no zone: strong's share text
   * has none, and it has no end time either). null when the date line is missing
   * or unparseable.
   */
  startedLocal: string | null;
  exercises: ParsedExercise[];
  /** workout-level notes (lines between the date and the first exercise) */
  notes: string[];
  /** full share link if present, e.g. "https://strong.app.link/AbC123" */
  link: string | null;
  /** last path segment of the link, used as an idempotency key */
  linkSlug: string | null;
  warnings: ParseWarning[];
  /** workout length in seconds when the source has it (strong's csv export); share text has none */
  durationS?: number | null;
}

// ---------------------------------------------------------------------------
// exercise catalog

/** ~20 body regions; the deltoid is split three ways */
export type MuscleRegion =
  | "chest"
  | "front_delts"
  | "side_delts"
  | "rear_delts"
  | "biceps"
  | "triceps"
  | "forearms"
  | "traps"
  | "lats"
  | "upper_back"
  | "lower_back"
  | "abs"
  | "obliques"
  | "glutes"
  | "quads"
  | "hamstrings"
  | "adductors"
  | "abductors"
  | "calves"
  | "neck";

export type Equipment =
  | "barbell"
  | "dumbbell"
  | "machine"
  | "cable"
  | "smith"
  | "ez_bar"
  | "kettlebell"
  | "band"
  | "bodyweight"
  | "weighted_bodyweight"
  | "assisted_bodyweight"
  | "plate"
  | "trap_bar"
  | "medicine_ball"
  | "foam_roll"
  | "cardio"
  | "other";

export type ExerciseCategory =
  | "strength"
  | "cardio"
  | "stretching"
  | "plyometrics"
  | "olympic"
  | "strongman"
  | "other";

/** which fields a set of this exercise records */
export type TrackingType =
  | "weight_reps"
  | "reps"
  | "weighted_bodyweight"
  | "assisted_bodyweight"
  | "duration"
  | "distance_duration"
  | "weight_distance";

export interface Exercise {
  /** stable slug, e.g. "overhead-press-barbell". never changes once shipped. */
  id: string;
  /** canonical display name in strong's style, e.g. "Overhead Press (Barbell)" */
  name: string;
  equipment: Equipment;
  category: ExerciseCategory;
  tracking: TrackingType;
  primary: MuscleRegion[];
  secondary: MuscleRegion[];
  /** alternate names users type or other apps print ("shoulder press", "ohp") */
  aliases: string[];
  /** yuhonas/free-exercise-db id this entry was derived from, if any */
  freeDbId?: string;
  /** true for hand-curated entries; false for entries mapped straight from free-exercise-db */
  curated: boolean;
}

// ---------------------------------------------------------------------------
// search

export type SearchTier = "exact" | "alias" | "prefix" | "fuzzy" | "muscle";

export interface SearchOptions {
  /** max results (default 50) */
  limit?: number;
  /** exercise id -> times used; boosts frequently used exercises within and across tiers */
  usage?: Readonly<Record<string, number>>;
  /** override the catalog (e.g. built-in + the user's custom exercises) */
  catalog?: readonly Exercise[];
}

export interface SearchResult {
  exercise: Exercise;
  tier: SearchTier;
  /** higher is better; only meaningful for ordering */
  score: number;
}

// ---------------------------------------------------------------------------
// activity linking (strength recordings from the watch)

export interface LinkCandidate {
  id: number;
  sportType: string;
  /** local wall-clock start "YYYY-MM-DDTHH:MM" (activities.local_date + local_time) */
  localStart: string;
  elapsedS: number;
}

/** overrun: the workout started inside a recording that began well before it (watch left running) */
export type LinkRole = "primary" | "duplicate" | "continuation" | "overrun";

export interface ActivityLink {
  activityId: number;
  role: LinkRole;
  /** candidate start minus workout start, in minutes (negative = watch started first) */
  deltaMin: number;
}
