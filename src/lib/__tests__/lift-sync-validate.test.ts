import { describe, it, expect } from "vitest";
import { SYNC_MAX_BATCH } from "lift-core";
import { PAYLOAD_SHAPES, nullableKeys, validateEnvelope, validateMutation } from "@/lib/lift/sync/validate";

const T = 1_793_000_000_000;
const ts = { createdAt: T, updatedAt: T };

const envelope = (over: Record<string, unknown> = {}) => ({
  protocol: 1,
  deviceId: "phone-1234abcd",
  mutations: [{ seq: 1 }, { seq: 2 }, { seq: 10 }],
  ...over,
});

describe("validateEnvelope", () => {
  it("accepts a well-formed envelope", () => {
    const res = validateEnvelope(envelope());
    expect(res).toMatchObject({ ok: true, deviceId: "phone-1234abcd" });
    if (res.ok) expect(res.mutations.map((m) => m.seq)).toEqual([1, 2, 10]);
    expect(validateEnvelope(envelope({ mutations: [] })).ok).toBe(true);
  });

  it.each([
    ["not an object", []],
    ["wrong protocol", envelope({ protocol: 2 })],
    ["missing protocol", envelope({ protocol: undefined })],
    ["short device id", envelope({ deviceId: "abc" })],
    ["device id with symbols", envelope({ deviceId: "phone_1234/abcd" })],
    ["long device id", envelope({ deviceId: "a".repeat(65) })],
    ["mutations not an array", envelope({ mutations: {} })],
    ["mutation not an object", envelope({ mutations: [1] })],
    ["zero seq", envelope({ mutations: [{ seq: 0 }] })],
    ["fractional seq", envelope({ mutations: [{ seq: 1.5 }] })],
    ["string seq", envelope({ mutations: [{ seq: "1" }] })],
    ["repeated seq", envelope({ mutations: [{ seq: 1 }, { seq: 1 }] })],
    ["decreasing seq", envelope({ mutations: [{ seq: 2 }, { seq: 1 }] })],
  ])("rejects %s", (_label, body) => {
    expect(validateEnvelope(body).ok).toBe(false);
  });

  it("caps the batch size", () => {
    const many = Array.from({ length: SYNC_MAX_BATCH + 1 }, (_, i) => ({ seq: i + 1 }));
    expect(validateEnvelope(envelope({ mutations: many }))).toEqual({ ok: false, error: `too many mutations (max ${SYNC_MAX_BATCH})` });
    expect(validateEnvelope(envelope({ mutations: many.slice(1) })).ok).toBe(true);
  });
});

const workout = {
  id: "w1",
  title: "Push",
  startedAt: T,
  endedAt: null,
  utcOffsetMin: -480,
  status: "active",
  templateId: null,
  notes: null,
  ...ts,
};

const m = (entity: string, op: string, payload: unknown, id = "w1") => ({ seq: 1, entity, op, id, payload, at: T });
const without = (o: Record<string, unknown>, ...keys: string[]) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));

describe("older app payloads", () => {
  it("reads every absent nullable key as null and passes it on as null", () => {
    const res = validateMutation(m("workout", "insert", without(workout, "utcOffsetMin", "templateId", "endedAt", "notes")));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.mutation.payload).toMatchObject({ utcOffsetMin: null, templateId: null, endedAt: null, notes: null });
  });

  it("covers the m1-era columns of every entity, and only nullable ones", () => {
    expect(nullableKeys(PAYLOAD_SHAPES.workout)).toEqual(expect.arrayContaining(["utcOffsetMin", "templateId"]));
    expect(nullableKeys(PAYLOAD_SHAPES.workout_exercise)).toContain("restS");
    expect(nullableKeys(PAYLOAD_SHAPES.custom_exercise)).toEqual(["mergedInto"]);
    for (const shape of Object.values(PAYLOAD_SHAPES)) {
      for (const key of ["id", "createdAt", "updatedAt"]) expect(nullableKeys(shape)).not.toContain(key);
    }
    expect(nullableKeys(PAYLOAD_SHAPES.set)).not.toContain("completed");
  });

  it("an m1 custom exercise without mergedInto is accepted, required keys stay strict", () => {
    const old = { id: "custom-x", name: "Belt Squat", equipment: "other", tracking: "weight_reps", primary: "[]", secondary: "[]", archived: 0, ...ts };
    const ok = validateMutation(m("custom_exercise", "insert", old, "custom-x"));
    expect(ok).toMatchObject({ ok: true, mutation: { payload: { mergedInto: null } } });
    expect(validateMutation(m("custom_exercise", "insert", without(old, "archived"), "custom-x"))).toEqual({
      ok: false,
      reason: "payload.archived is missing",
    });
  });
});

describe("validateMutation", () => {
  it("accepts a valid upsert and a valid delete", () => {
    expect(validateMutation(m("workout", "insert", workout))).toMatchObject({ ok: true, mutation: { entity: "workout", op: "insert" } });
    expect(validateMutation(m("set", "delete", null, "s1"))).toMatchObject({ ok: true, mutation: { payload: null } });
  });

  it("ignores unknown payload keys (newer app columns)", () => {
    expect(validateMutation(m("workout", "update", { ...workout, rating: 5 })).ok).toBe(true);
  });

  it.each([
    ["unknown entity", m("workouts", "insert", workout), "unknown entity"],
    ["unknown op", m("workout", "upsert", workout), "unknown op"],
    ["empty id", m("workout", "insert", { ...workout, id: "" }, ""), "id length must be 1..128"],
    ["missing at", { ...m("workout", "insert", workout), at: undefined }, "at must be an integer"],
    ["delete with payload", m("workout", "delete", workout), "delete must have a null payload"],
    ["missing payload", m("workout", "insert", null), "payload.must be an object"],
    ["id mismatch", m("workout", "insert", { ...workout, id: "w2" }), "payload.id does not match id"],
    ["missing field", m("workout", "insert", { ...workout, notes: undefined }), "payload.notes must be a string"],
    ["absent required field", m("workout", "insert", without(workout, "title")), "payload.title is missing"],
    ["absent required timestamp", m("workout", "insert", without(workout, "updatedAt")), "payload.updatedAt is missing"],
    ["bad status", m("workout", "insert", { ...workout, status: "paused" }), "payload.status must be one of active, finished, discarded"],
    ["float ms", m("workout", "insert", { ...workout, startedAt: 1.5 }), "payload.startedAt must be an integer"],
    ["iso date instead of ms", m("workout", "insert", { ...workout, updatedAt: "2026-11-04" }), "payload.updatedAt must be an integer"],
  ])("rejects %s", (_label, raw, reason) => {
    expect(validateMutation(raw as Record<string, unknown>)).toEqual({ ok: false, reason });
  });

  const set = {
    id: "s1",
    workoutExerciseId: "we1",
    position: 0,
    kind: "normal",
    weight: 100,
    unit: "kg",
    reps: 5,
    durationS: null,
    distanceM: null,
    rpe: 8.5,
    completed: 1,
    note: null,
    ...ts,
  };

  it("type-checks sets: flags are 0/1, units and kinds are enums", () => {
    expect(validateMutation(m("set", "insert", set, "s1")).ok).toBe(true);
    expect(validateMutation(m("set", "insert", { ...set, completed: true }, "s1"))).toEqual({ ok: false, reason: "payload.completed must be 0 or 1" });
    expect(validateMutation(m("set", "insert", { ...set, unit: "lbs" }, "s1")).ok).toBe(false);
    expect(validateMutation(m("set", "insert", { ...set, kind: "amrap" }, "s1")).ok).toBe(false);
    expect(validateMutation(m("set", "insert", { ...set, weight: Number.NaN }, "s1")).ok).toBe(false);
    expect(validateMutation(m("set", "insert", { ...set, rpe: 11 }, "s1")).ok).toBe(false);
  });

  const custom = {
    id: "custom-aaaaaaaaaaaa",
    name: "Landmine Press",
    equipment: "barbell",
    tracking: "weight_reps",
    primary: '["front_delts"]',
    secondary: "[]",
    archived: 0,
    mergedInto: null,
    ...ts,
  };

  it("checks json-text muscle arrays and self-merges", () => {
    const id = custom.id;
    expect(validateMutation(m("custom_exercise", "insert", custom, id)).ok).toBe(true);
    expect(validateMutation(m("custom_exercise", "insert", { ...custom, primary: '["wings"]' }, id)).ok).toBe(false);
    expect(validateMutation(m("custom_exercise", "insert", { ...custom, primary: "chest" }, id))).toEqual({
      ok: false,
      reason: "payload.primary is not valid json",
    });
    expect(validateMutation(m("custom_exercise", "insert", { ...custom, primary: ["chest"] }, id)).ok).toBe(false);
    expect(validateMutation(m("custom_exercise", "insert", { ...custom, equipment: "rock" }, id)).ok).toBe(false);
    expect(validateMutation(m("custom_exercise", "insert", { ...custom, mergedInto: id }, id))).toEqual({
      ok: false,
      reason: "an exercise can't be merged into itself",
    });
  });

  it("checks planned sets inside template exercises", () => {
    const te = {
      id: "te1",
      templateId: "t1",
      exerciseId: "bench-press-barbell",
      position: 0,
      supersetGroup: null,
      restS: 90,
      plannedSets: JSON.stringify([{ kind: "normal", weight: 135, unit: "lb", reps: 8, durationS: null, distanceM: null }]),
      notes: null,
      ...ts,
    };
    expect(validateMutation(m("template_exercise", "insert", te, "te1")).ok).toBe(true);
    const bad = { ...te, plannedSets: JSON.stringify([{ kind: "normal", weight: 135, unit: "lb", reps: "8", durationS: null, distanceM: null }]) };
    expect(validateMutation(m("template_exercise", "insert", bad, "te1"))).toEqual({
      ok: false,
      reason: "payload.plannedSets [0] reps must be an integer",
    });
  });

  it("validates folders, templates and bodyweights", () => {
    expect(validateMutation(m("template_folder", "insert", { id: "f1", name: "PPL", position: 0, ...ts }, "f1")).ok).toBe(true);
    expect(validateMutation(m("template_folder", "insert", { id: "f1", name: "", position: 0, ...ts }, "f1")).ok).toBe(false);
    const tp = { id: "t1", folderId: null, name: "Push", notes: null, position: 1, archived: 0, ...ts };
    expect(validateMutation(m("template", "insert", tp, "t1")).ok).toBe(true);
    expect(validateMutation(m("template", "insert", { ...tp, position: -1 }, "t1")).ok).toBe(false);
    const bw = { id: "bw1", measuredAt: T, weight: 180, unit: "lb", note: null, ...ts };
    expect(validateMutation(m("bodyweight", "insert", bw, "bw1")).ok).toBe(true);
    expect(validateMutation(m("bodyweight", "insert", { ...bw, weight: 0 }, "bw1")).ok).toBe(false);
    const wex = { id: "we1", workoutId: "w1", exerciseId: "x", position: 0, notes: null, supersetGroup: null, restS: null, ...ts };
    expect(validateMutation(m("workout_exercise", "insert", wex, "we1")).ok).toBe(true);
    expect(validateMutation(m("workout_exercise", "insert", { ...wex, restS: -5 }, "we1")).ok).toBe(false);
  });
});

describe("program payloads", () => {
  const data = JSON.stringify({ version: 1, weeks: [{ days: [{ templateId: "t1" }] }], rules: {}, startedAt: null, skipped: 0, repeat: false });
  const program = { id: "p1", name: "5x5", data, active: 0, ...ts };
  const reason = (payload: Record<string, unknown>) => {
    const r = validateMutation(m("program", "insert", payload, "p1"));
    return r.ok ? null : r.reason;
  };

  it("accepts a program and its delete", () => {
    expect(reason(program)).toBeNull();
    expect(validateMutation(m("program", "delete", null, "p1")).ok).toBe(true);
  });

  it.each([
    ["data that isn't json", { ...program, data: "{" }, "payload.data is not valid json"],
    ["data of the wrong version", { ...program, data: data.replace('"version":1', '"version":9') }, "payload.data version must be 1"],
    ["a bad rule", { ...program, data: data.replace('"rules":{}', '"rules":{"te1":{"kind":"linear"}}') }, "payload.data rules.te1 is not a valid rule"],
    ["oversized data", { ...program, data: "x".repeat(100_001) }, "payload.data length must be at most 100000"],
    ["a non-flag active", { ...program, active: true }, "payload.active must be 0 or 1"],
    ["an empty name", { ...program, name: "" }, "payload.name length must be 1..200"],
  ])("rejects %s", (_label, payload, expected) => {
    expect(reason(payload)).toBe(expected);
  });
});
