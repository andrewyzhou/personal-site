import { describe, it, expect } from "vitest";
import type { LiftSetRow, LiftWorkoutRow } from "@/lib/db/lift-schema";
import {
  buildSnapshot,
  customExercisePayload,
  setPayload,
  templateExercisePayload,
  workoutPayload,
} from "@/lib/lift/sync/snapshot";
import { validateMutation } from "@/lib/lift/sync/validate";

const C = new Date("2026-11-05T02:20:00Z");
const U = new Date("2026-11-05T03:00:00Z");

function workoutRow(over: Partial<LiftWorkoutRow> = {}): LiftWorkoutRow {
  return {
    id: "strong-Slug1",
    title: "Push Day",
    startedLocal: "2026-11-04T18:12",
    startedAt: new Date("2026-11-05T02:12:00Z"),
    utcOffsetMin: -480,
    endedAt: null,
    durationS: null,
    notes: null,
    source: "strong-text",
    status: "finished",
    templateId: null,
    latestIngestId: "ing_x",
    strongSlug: "Slug1",
    workingSets: 3,
    volumeKg: 1000,
    muscleLoad: {},
    deletedAt: null,
    createdAt: C,
    updatedAt: U,
    ...over,
  };
}

function setRowOf(over: Partial<LiftSetRow> = {}): LiftSetRow {
  return {
    id: "strong-Slug1:0:0",
    workoutExerciseId: "strong-Slug1:0",
    position: 0,
    kind: "normal",
    weight: 185,
    unit: "lb",
    weightKg: 83.9,
    reps: 5,
    durationS: null,
    distanceM: null,
    rpe: null,
    bodyweight: false,
    note: null,
    e1rmKg: 97.9,
    completed: true,
    createdAt: C,
    updatedAt: U,
    ...over,
  };
}

// every mapped payload must survive the push validator, so a restore can be pushed back
function roundTrips(entity: string, payload: { id: string }) {
  return validateMutation({ seq: 1, entity, op: "update", id: payload.id, payload, at: 0 });
}

describe("snapshot mapping", () => {
  it("maps a strong share to a finished workout with ms timestamps", () => {
    const p = workoutPayload(workoutRow());
    expect(p).toEqual({
      id: "strong-Slug1",
      title: "Push Day",
      startedAt: Date.parse("2026-11-05T02:12:00Z"),
      endedAt: null,
      utcOffsetMin: -480,
      status: "finished",
      templateId: null,
      notes: null,
      createdAt: C.getTime(),
      updatedAt: U.getTime(),
    });
    expect(roundTrips("workout", p).ok).toBe(true);
  });

  it("derives startedAt from the wall clock when a strong row has none", () => {
    const p = workoutPayload(workoutRow({ startedAt: null, utcOffsetMin: null }), "America/Los_Angeles");
    expect(p.startedAt).toBe(Date.parse("2026-11-05T02:12:00Z"));
    expect(p.utcOffsetMin).toBe(-480);
  });

  it("derives endedAt from a linked duration", () => {
    expect(workoutPayload(workoutRow({ durationS: 3600 })).endedAt).toBe(Date.parse("2026-11-05T03:12:00Z"));
  });

  it("keeps app workout status, but strong rows are always finished", () => {
    expect(workoutPayload(workoutRow({ source: "app", status: "active" })).status).toBe("active");
    expect(workoutPayload(workoutRow({ source: "app", status: "discarded" })).status).toBe("discarded");
    expect(workoutPayload(workoutRow({ source: "strong-text", status: "discarded" })).status).toBe("finished");
    expect(workoutPayload(workoutRow({ source: "app", status: "weird" })).status).toBe("finished");
  });

  it("maps sets with 0/1 completed and an lb default unit", () => {
    const p = setPayload(setRowOf({ unit: null, weight: null }));
    expect(p).toMatchObject({ completed: 1, unit: "lb", weight: null, createdAt: C.getTime() });
    expect(setPayload(setRowOf({ completed: false })).completed).toBe(0);
    expect(roundTrips("set", p).ok).toBe(true);
  });

  it("maps custom exercises with json-text muscle arrays", () => {
    const row = {
      id: "custom-aaaaaaaaaaaa",
      name: "Landmine Press",
      equipment: "barbell",
      category: "strength",
      tracking: "weight_reps",
      source: "strong",
      isCustom: true,
      archived: false,
      freeDbId: null,
      mergedInto: null,
      createdAt: C,
      updatedAt: U,
    };
    const p = customExercisePayload(row, [
      { exerciseId: row.id, region: "triceps", role: "secondary" },
      { exerciseId: row.id, region: "front_delts", role: "primary" },
      { exerciseId: "other", region: "chest", role: "primary" },
    ]);
    expect(p).toMatchObject({ primary: '["front_delts"]', secondary: '["triceps"]', archived: 0 });
    expect(roundTrips("custom_exercise", p).ok).toBe(true);
    // strong's guessed equipment strings outside the enum fall back
    expect(customExercisePayload({ ...row, equipment: "mystery" }, []).equipment).toBe("other");
  });

  it("maps template exercises with planned sets as json text", () => {
    const p = templateExercisePayload({
      id: "te1",
      templateId: "t1",
      exerciseId: "bench-press-barbell",
      position: 0,
      plannedSets: [{ kind: "normal", weight: 135, unit: "lb", reps: 8 }],
      notes: null,
      supersetGroup: null,
      restS: 90,
      createdAt: C,
      updatedAt: U,
    });
    expect(JSON.parse(p.plannedSets)).toEqual([{ kind: "normal", weight: 135, unit: "lb", reps: 8, durationS: null, distanceM: null }]);
    expect(roundTrips("template_exercise", p).ok).toBe(true);
  });

  it("assembles the whole snapshot", () => {
    const snap = buildSnapshot(
      {
        customExercises: [],
        muscles: [],
        templateFolders: [{ id: "f1", name: "PPL", position: 0, createdAt: C, updatedAt: U }],
        templates: [{ id: "t1", name: "Push", folder: null, folderId: "f1", notes: null, position: 0, archived: false, createdAt: C, updatedAt: U }],
        templateExercises: [],
        workouts: [workoutRow()],
        workoutExercises: [
          {
            id: "strong-Slug1:0",
            workoutId: "strong-Slug1",
            exerciseId: "bench-press-barbell",
            position: 0,
            nameRaw: "Bench Press (Barbell)",
            notes: null,
            supersetGroup: null,
            restS: null,
            createdAt: C,
            updatedAt: U,
          },
        ],
        sets: [setRowOf()],
        bodyweights: [{ id: "bw1", measuredAt: C, weight: 180, unit: "lb", note: null, createdAt: C, updatedAt: U }],
      },
      new Date(5000)
    );
    expect(snap.protocol).toBe(1);
    expect(snap.generatedAt).toBe(5000);
    expect(snap.templates[0]).toMatchObject({ folderId: "f1", archived: 0 });
    expect(snap.workoutExercises[0]).not.toHaveProperty("nameRaw");
    expect(snap.sets).toHaveLength(1);
    expect(snap.bodyweights[0]).toMatchObject({ measuredAt: C.getTime(), unit: "lb" });
    for (const [entity, payload] of [
      ["template_folder", snap.templateFolders[0]],
      ["template", snap.templates[0]],
      ["workout_exercise", snap.workoutExercises[0]],
      ["bodyweight", snap.bodyweights[0]],
    ] as const) {
      expect(roundTrips(entity, payload).ok).toBe(true);
    }
  });
});
