// push-only sync contract between the phone (source of truth) and the site.
// payloads are the phone's sqlite rows as drizzle returns them: camelCase keys,
// epoch-ms integers for times, 0/1 integers for flags, json text for arrays.
// the server converts on its side; the phone never transforms rows to push them.

import type { Equipment, SetKind, TrackingType, WeightUnit } from "./types";

export const SYNC_PROTOCOL_VERSION = 1;

export const SYNC_ENTITIES = [
  "custom_exercise",
  "template_folder",
  "template",
  "template_exercise",
  "workout",
  "workout_exercise",
  "set",
  "bodyweight",
  "program",
] as const;
export type SyncEntity = (typeof SYNC_ENTITIES)[number];

export type SyncOp = "insert" | "update" | "delete";

/** max mutations per push request */
export const SYNC_MAX_BATCH = 500;

export type WorkoutStatus = "active" | "finished" | "discarded";

export interface WorkoutPayload {
  id: string;
  title: string;
  startedAt: number;
  endedAt: number | null;
  /** device utc offset at start, minutes east of utc (-480 for pst) */
  utcOffsetMin: number | null;
  status: WorkoutStatus;
  templateId: string | null;
  notes: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface WorkoutExercisePayload {
  id: string;
  workoutId: string;
  /** lift-core catalog slug or a custom exercise id */
  exerciseId: string;
  position: number;
  notes: string | null;
  supersetGroup: number | null;
  /** rest seconds after each set of this exercise; null = app default */
  restS: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface SetPayload {
  id: string;
  workoutExerciseId: string;
  position: number;
  kind: SetKind;
  weight: number | null;
  unit: WeightUnit;
  reps: number | null;
  durationS: number | null;
  distanceM: number | null;
  rpe: number | null;
  completed: 0 | 1;
  note: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface CustomExercisePayload {
  /** "custom-" + 12 hex of sha256(nameKey(original name)); see customExerciseId */
  id: string;
  name: string;
  equipment: Equipment;
  tracking: TrackingType;
  /** json array of MuscleRegion */
  primary: string;
  /** json array of MuscleRegion */
  secondary: string;
  archived: 0 | 1;
  /** set when merged into another exercise (catalog slug or custom id) */
  mergedInto: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface TemplateFolderPayload {
  id: string;
  name: string;
  position: number;
  createdAt: number;
  updatedAt: number;
}

export interface TemplatePayload {
  id: string;
  folderId: string | null;
  name: string;
  notes: string | null;
  position: number;
  archived: 0 | 1;
  createdAt: number;
  updatedAt: number;
}

export interface PlannedSetPayload {
  kind: SetKind;
  weight: number | null;
  unit: WeightUnit;
  reps: number | null;
  durationS: number | null;
  distanceM: number | null;
}

export interface TemplateExercisePayload {
  id: string;
  templateId: string;
  exerciseId: string;
  position: number;
  supersetGroup: number | null;
  restS: number | null;
  /** json array of PlannedSetPayload */
  plannedSets: string;
  notes: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface BodyweightPayload {
  id: string;
  measuredAt: number;
  weight: number;
  unit: WeightUnit;
  note: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ProgramPayload {
  id: string;
  name: string;
  /** json text of ProgramData (programs.ts); template ids inside are not foreign keys */
  data: string;
  /** the program home's "next up" follows; the phone keeps at most one active */
  active: 0 | 1;
  createdAt: number;
  updatedAt: number;
}

export interface SyncPayloads {
  custom_exercise: CustomExercisePayload;
  template_folder: TemplateFolderPayload;
  template: TemplatePayload;
  template_exercise: TemplateExercisePayload;
  workout: WorkoutPayload;
  workout_exercise: WorkoutExercisePayload;
  set: SetPayload;
  bodyweight: BodyweightPayload;
  program: ProgramPayload;
}

export interface SyncMutation<E extends SyncEntity = SyncEntity> {
  /** the outbox row id: strictly increasing per device */
  seq: number;
  entity: E;
  id: string;
  op: SyncOp;
  /** full row after the write; null for deletes */
  payload: SyncPayloads[E] | null;
  /** client time the change was made, epoch ms */
  at: number;
}

/** POST /api/lift/sync (bearer LIFT_APP_TOKEN) */
export interface SyncPushRequest {
  protocol: typeof SYNC_PROTOCOL_VERSION;
  deviceId: string;
  mutations: SyncMutation[];
}

export interface SyncPushResponse {
  ok: true;
  /** highest seq the server has durably applied (or already had) for this device */
  appliedThrough: number;
  applied: number;
  /** already-seen seqs (replays) */
  skipped: number;
  /** mutations the server refused; the phone marks them synced and keeps them for inspection */
  rejected: { seq: number; reason: string }[];
}

/** everything, for a reinstall restore. the phone assembles it from snapshot pages. */
export interface SyncSnapshot {
  protocol: typeof SYNC_PROTOCOL_VERSION;
  generatedAt: number;
  customExercises: CustomExercisePayload[];
  templateFolders: TemplateFolderPayload[];
  templates: TemplatePayload[];
  templateExercises: TemplateExercisePayload[];
  /** includes workouts that came from share text, as finished workouts */
  workouts: WorkoutPayload[];
  workoutExercises: WorkoutExercisePayload[];
  sets: SetPayload[];
  bodyweights: BodyweightPayload[];
  programs: ProgramPayload[];
}

/** snapshot keys in fk order: parents before children, so a restore can insert in this order */
export const SNAPSHOT_ENTITIES = [
  "customExercises",
  "templateFolders",
  "templates",
  "templateExercises",
  "workouts",
  "workoutExercises",
  "sets",
  "bodyweights",
  // last: programs only reference templates by id inside their json
  "programs",
] as const satisfies readonly (keyof SyncSnapshot)[];
export type SnapshotEntity = (typeof SNAPSHOT_ENTITIES)[number];

/** max rows per snapshot page; keeps every response well under the host's ~4.5mb cap */
export const SNAPSHOT_PAGE_MAX = 2000;

/**
 * GET /api/lift/sync/snapshot?entity=<key>&after=<id>&limit=<n> (bearer LIFT_APP_TOKEN).
 * rows come in id order after the `after` cursor (omitted = from the start);
 * `next` is the cursor for the following page, null on the last one.
 */
export interface SyncSnapshotPage<K extends SnapshotEntity = SnapshotEntity> {
  protocol: typeof SYNC_PROTOCOL_VERSION;
  entity: K;
  rows: SyncSnapshot[K];
  next: string | null;
  generatedAt: number;
}

/**
 * workouts that came from share text or a csv import ("share-" and "workout-csv-" ids).
 * the phone treats them as read-only history: the server refuses new exercises
 * or sets in them, since a re-share replaces their contents wholesale. the
 * phone's status still drives their soft delete (discarded hides, finished shows).
 */
export function isImportedWorkoutId(id: string): boolean {
  return id.startsWith("share-") || id.startsWith("workout-csv-");
}
