import {
  MAX_PROGRAM_DATA_LENGTH,
  MUSCLE_REGIONS,
  checkProgramData,
  SYNC_ENTITIES,
  SYNC_MAX_BATCH,
  SYNC_PROTOCOL_VERSION,
  type SyncEntity,
  type SyncMutation,
  type SyncOp,
} from "lift-core";

// hand-rolled validation for the push contract in lift-core/sync.ts. the
// envelope (protocol, device, seqs) is all-or-nothing; a bad individual
// mutation is only rejected, so one odd row can't wedge the phone's outbox.

export const DEVICE_ID_RE = /^[A-Za-z0-9-]{8,64}$/;
const MAX_ID = 128;
const MAX_TEXT = 10_000;

export interface EnvelopeMutation {
  seq: number;
  raw: Record<string, unknown>;
}

export type EnvelopeResult =
  | { ok: true; deviceId: string; mutations: EnvelopeMutation[] }
  | { ok: false; error: string };

export type MutationResult = { ok: true; mutation: SyncMutation } | { ok: false; reason: string };

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function validateEnvelope(body: unknown): EnvelopeResult {
  if (!isObject(body)) return { ok: false, error: "expected a json object" };
  if (body.protocol !== SYNC_PROTOCOL_VERSION) {
    return { ok: false, error: `unsupported protocol (expected ${SYNC_PROTOCOL_VERSION})` };
  }
  if (typeof body.deviceId !== "string" || !DEVICE_ID_RE.test(body.deviceId)) {
    return { ok: false, error: "deviceId must match [A-Za-z0-9-]{8,64}" };
  }
  if (!Array.isArray(body.mutations)) return { ok: false, error: "mutations must be an array" };
  if (body.mutations.length > SYNC_MAX_BATCH) {
    return { ok: false, error: `too many mutations (max ${SYNC_MAX_BATCH})` };
  }
  const mutations: EnvelopeMutation[] = [];
  let last = 0;
  for (const [i, m] of body.mutations.entries()) {
    if (!isObject(m)) return { ok: false, error: `mutations[${i}] is not an object` };
    const seq = m.seq;
    if (typeof seq !== "number" || !Number.isSafeInteger(seq) || seq <= 0) {
      return { ok: false, error: `mutations[${i}].seq must be a positive integer` };
    }
    // strictly increasing is what makes appliedThrough meaningful
    if (seq <= last) return { ok: false, error: `mutations[${i}].seq is not strictly increasing` };
    last = seq;
    mutations.push({ seq, raw: m });
  }
  return { ok: true, deviceId: body.deviceId, mutations };
}

// field checks: each returns an error message or null
type Check = (v: unknown) => string | null;

// nullable checks are remembered so a missing key can read as null
const NULLABLE = new WeakSet<Check>();

const nullable = (check: Check): Check => {
  const c: Check = (v) => (v === null ? null : check(v));
  NULLABLE.add(c);
  return c;
};

const text =
  (max = MAX_TEXT, min = 0): Check =>
  (v) =>
    typeof v !== "string" ? "must be a string" : v.length < min || v.length > max ? `length must be ${min}..${max}` : null;

const id: Check = text(MAX_ID, 1);

const int =
  (min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER): Check =>
  (v) =>
    typeof v !== "number" || !Number.isSafeInteger(v) ? "must be an integer" : v < min || v > max ? `must be ${min}..${max}` : null;

// epoch ms; up to year ~2286
const ms: Check = int(0, 9_999_999_999_999);

const num =
  (min = -Infinity, max = Infinity): Check =>
  (v) =>
    typeof v !== "number" || !Number.isFinite(v) ? "must be a finite number" : v < min || v > max ? `must be ${min}..${max}` : null;

const flag: Check = (v) => (v === 0 || v === 1 ? null : "must be 0 or 1");

const oneOf =
  (values: readonly string[]): Check =>
  (v) =>
    typeof v === "string" && values.includes(v) ? null : `must be one of ${values.join(", ")}`;

type Shape = Record<string, Check>;

/** which keys of `shape` this object lacks but may treat as null */
export function nullableKeys(shape: Shape): string[] {
  return Object.entries(shape)
    .filter(([, check]) => NULLABLE.has(check))
    .map(([key]) => key);
}

function checkShape(obj: unknown, shape: Shape): string | null {
  if (!isObject(obj)) return "must be an object";
  // unknown keys are ignored so a newer app column doesn't reject every push
  for (const [key, check] of Object.entries(shape)) {
    // older app builds predate some nullable columns: absent reads as null
    if (!(key in obj)) {
      if (NULLABLE.has(check)) continue;
      return `${key} is missing`;
    }
    const err = check(obj[key]);
    if (err) return `${key} ${err}`;
  }
  return null;
}

/** copy with every absent nullable key set to null, so mappers never see undefined */
function withNulls(obj: Record<string, unknown>, shape: Shape): Record<string, unknown> {
  const out = { ...obj };
  for (const [key, check] of Object.entries(shape)) if (!(key in out) && NULLABLE.has(check)) out[key] = null;
  return out;
}

const jsonArray =
  (item: Check): Check =>
  (v) => {
    if (typeof v !== "string") return "must be a json array string";
    let parsed: unknown;
    try {
      parsed = JSON.parse(v);
    } catch {
      return "is not valid json";
    }
    if (!Array.isArray(parsed)) return "must be a json array";
    for (const [i, el] of parsed.entries()) {
      const err = item(el);
      if (err) return `[${i}] ${err}`;
    }
    return null;
  };

export const SET_KINDS = ["warmup", "normal", "drop", "failure"] as const;
export const WEIGHT_UNITS = ["lb", "kg"] as const;
export const WORKOUT_STATUSES = ["active", "finished", "discarded"] as const;
export const EQUIPMENT = [
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
] as const;
export const TRACKING_TYPES = [
  "weight_reps",
  "reps",
  "weighted_bodyweight",
  "assisted_bodyweight",
  "duration",
  "distance_duration",
  "weight_distance",
] as const;

const timestamps: Shape = { createdAt: ms, updatedAt: ms };
const reps = nullable(int(0, 100_000));
const seconds = nullable(int(0, 10_000_000));
const weight = nullable(num(-100_000, 100_000));
const distance = nullable(num(0, 10_000_000));

const plannedSet: Check = (v) =>
  checkShape(v, {
    kind: oneOf(SET_KINDS),
    weight,
    unit: oneOf(WEIGHT_UNITS),
    reps,
    durationS: seconds,
    distanceM: distance,
  });

const muscle = oneOf(MUSCLE_REGIONS);

// json text of lift-core's ProgramData, checked strictly so the jsonb column only holds real programs
const programData: Check = (v) => {
  if (typeof v !== "string") return "must be a json string";
  if (v.length > MAX_PROGRAM_DATA_LENGTH) return `length must be at most ${MAX_PROGRAM_DATA_LENGTH}`;
  let parsed: unknown;
  try {
    parsed = JSON.parse(v);
  } catch {
    return "is not valid json";
  }
  return checkProgramData(parsed);
};

export const PAYLOAD_SHAPES: Record<SyncEntity, Shape> = {
  workout: {
    id,
    title: text(500),
    startedAt: ms,
    endedAt: nullable(ms),
    utcOffsetMin: nullable(int(-16 * 60, 16 * 60)),
    status: oneOf(WORKOUT_STATUSES),
    templateId: nullable(id),
    notes: nullable(text()),
    ...timestamps,
  },
  workout_exercise: {
    id,
    workoutId: id,
    exerciseId: id,
    position: int(0, 100_000),
    notes: nullable(text()),
    supersetGroup: nullable(int(0, 100_000)),
    restS: seconds,
    ...timestamps,
  },
  set: {
    id,
    workoutExerciseId: id,
    position: int(0, 100_000),
    kind: oneOf(SET_KINDS),
    weight,
    unit: oneOf(WEIGHT_UNITS),
    reps,
    durationS: seconds,
    distanceM: distance,
    rpe: nullable(num(0, 10)),
    completed: flag,
    note: nullable(text()),
    ...timestamps,
  },
  custom_exercise: {
    id,
    name: text(200, 1),
    equipment: oneOf(EQUIPMENT),
    tracking: oneOf(TRACKING_TYPES),
    primary: jsonArray(muscle),
    secondary: jsonArray(muscle),
    archived: flag,
    mergedInto: nullable(id),
    ...timestamps,
  },
  template_folder: { id, name: text(200, 1), position: int(0, 100_000), ...timestamps },
  template: {
    id,
    folderId: nullable(id),
    name: text(200, 1),
    notes: nullable(text()),
    position: int(0, 100_000),
    archived: flag,
    ...timestamps,
  },
  template_exercise: {
    id,
    templateId: id,
    exerciseId: id,
    position: int(0, 100_000),
    supersetGroup: nullable(int(0, 100_000)),
    restS: seconds,
    plannedSets: jsonArray(plannedSet),
    notes: nullable(text()),
    ...timestamps,
  },
  bodyweight: {
    id,
    measuredAt: ms,
    weight: num(0.001, 100_000),
    unit: oneOf(WEIGHT_UNITS),
    note: nullable(text()),
    ...timestamps,
  },
  program: { id, name: text(200, 1), data: programData, active: flag, ...timestamps },
};

const OPS: readonly SyncOp[] = ["insert", "update", "delete"];

/** one mutation against the contract; envelope checks (seq) already passed */
export function validateMutation(raw: Record<string, unknown>): MutationResult {
  const entity = raw.entity;
  if (typeof entity !== "string" || !(SYNC_ENTITIES as readonly string[]).includes(entity)) {
    return { ok: false, reason: "unknown entity" };
  }
  if (typeof raw.op !== "string" || !OPS.includes(raw.op as SyncOp)) return { ok: false, reason: "unknown op" };
  const op = raw.op as SyncOp;
  const idErr = id(raw.id);
  if (idErr) return { ok: false, reason: `id ${idErr}` };
  const mid = raw.id as string;
  const atErr = ms(raw.at);
  if (atErr) return { ok: false, reason: `at ${atErr}` };

  if (op === "delete") {
    if (raw.payload != null) return { ok: false, reason: "delete must have a null payload" };
    return {
      ok: true,
      mutation: { seq: raw.seq as number, entity: entity as SyncEntity, id: mid, op, payload: null, at: raw.at as number },
    };
  }
  const shape = PAYLOAD_SHAPES[entity as SyncEntity];
  const shapeErr = checkShape(raw.payload, shape);
  if (shapeErr) return { ok: false, reason: `payload.${shapeErr}` };
  const payload = withNulls(raw.payload as Record<string, unknown>, shape);
  if (payload.id !== mid) return { ok: false, reason: "payload.id does not match id" };
  if (entity === "custom_exercise" && payload.mergedInto === mid) {
    return { ok: false, reason: "an exercise can't be merged into itself" };
  }
  return {
    ok: true,
    mutation: {
      seq: raw.seq as number,
      entity: entity as SyncEntity,
      id: mid,
      op,
      payload: payload as unknown as SyncMutation["payload"],
      at: raw.at as number,
    },
  };
}
