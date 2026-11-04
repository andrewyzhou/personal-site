import { describe, it, expect, vi } from "vitest";
import type { ParsedSet, ParsedWorkout } from "lift-core";

// lift-core's id helpers may still be stubs; same algorithm as the site's
vi.mock("lift-core", async (orig) => {
  const real = await orig<typeof import("lift-core")>();
  const { createHash } = await import("node:crypto");
  const sha256Hex = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");
  const nameKey = (n: string) => real.normalizeName(n) || n.normalize("NFKC").toLowerCase().trim();
  return { ...real, sha256Hex, nameKey, customExerciseId: (n: string) => `custom-${sha256Hex(nameKey(n)).slice(0, 12)}` };
});

import { sha256Hex } from "lift-core";
import {
  csvIngestRow,
  csvWorkoutId,
  dedupeKey,
  partitionCsvWorkouts,
  planCsvWorkouts,
} from "@/lib/lift/sync/strong-csv";

// what parseStrongCsv returns for a tiny export (the parser itself is tested in lift-core)
const CSV = `Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE
2024-01-02 18:00:00,Push Day,1h 5m,Bench Press (Barbell),1,185,5,0,0,,,
2024-01-02 18:00:00,Push Day,1h 5m,Bench Press (Barbell),2,185,5,0,0,,,
2024-01-04 07:30:00,Legs,45m,Squat (Barbell),1,225,5,0,0,,,`;

function set(position: number, weight: number, reps: number): ParsedSet {
  return {
    position,
    kind: "normal",
    label: position + 1,
    weight,
    unit: "lb",
    reps,
    durationS: null,
    distance: null,
    distanceUnit: null,
    rpe: null,
    bodyweight: false,
    note: null,
    raw: "",
  };
}

function workout(title: string, startedLocal: string | null, exercise = "Bench Press (Barbell)", durationS?: number): ParsedWorkout & { durationS?: number } {
  return {
    title,
    startedLocal,
    exercises: [{ name: exercise, sets: [set(0, 185, 5), set(1, 185, 5)], notes: [] }],
    notes: [],
    link: null,
    linkSlug: null,
    warnings: [],
    durationS,
  };
}

describe("strong csv import", () => {
  it("dedupes on start minute + normalized title", () => {
    expect(dedupeKey("  Push Day ", "2024-01-02T18:00")).toBe(dedupeKey("push day", "2024-01-02T18:00"));
    expect(dedupeKey("Push Day!", "2024-01-02T18:00")).toBe(dedupeKey("push day", "2024-01-02T18:00"));
    expect(dedupeKey("Push Day", "2024-01-02T18:00")).not.toBe(dedupeKey("Push Day", "2024-01-02T18:01"));
    expect(dedupeKey("", "2024-01-02T18:00")).toBe(dedupeKey("Workout", "2024-01-02T18:00"));
  });

  it("derives stable ids from title + start", () => {
    const id = csvWorkoutId("Push Day", "2024-01-02T18:00");
    expect(id).toMatch(/^strong-csv-[0-9a-f]{16}$/);
    expect(id).toBe(`strong-csv-${sha256Hex("push day|2024-01-02T18:00").slice(0, 16)}`);
    expect(csvWorkoutId(" push  day ", "2024-01-02T18:00")).toBe(id);
  });

  it("splits fresh workouts from ones already logged by share text", () => {
    const parsed = [
      workout("Push Day", "2024-01-02T18:00"),
      workout("Legs", "2024-01-04T07:30", "Squat (Barbell)"),
      workout("Legs", "2024-01-04T07:30", "Squat (Barbell)"), // repeated group in the csv
      workout("Mystery", null),
      { ...workout("Empty", "2024-01-05T10:00"), exercises: [] },
    ];
    const part = partitionCsvWorkouts(parsed, [{ title: "push day", startedLocal: "2024-01-02T18:00" }]);
    expect(part.fresh.map((w) => w.title)).toEqual(["Legs"]);
    expect(part.present.map((w) => w.title)).toEqual(["Push Day", "Legs"]);
    expect(part.unusable.map((u) => u.reason)).toEqual(["no date", "no exercises"]);
    // re-running after an import finds everything present
    const again = partitionCsvWorkouts(parsed, [
      { title: "push day", startedLocal: "2024-01-02T18:00" },
      { title: "Legs", startedLocal: "2024-01-04T07:30" },
    ]);
    expect(again.fresh).toEqual([]);
  });

  it("plans csv workouts through the ingest planner with csv provenance and duration", () => {
    const sha = sha256Hex(CSV);
    const ingest = csvIngestRow(CSV, sha, []);
    expect(ingest).toMatchObject({ id: `ing_${sha.slice(0, 24)}`, source: "strong-csv", rawSha256: sha, rawText: CSV, workoutId: null });

    const { plans, customIds } = planCsvWorkouts([workout("Push Day", "2024-01-02T18:00", "Bench Press (Barbell)", 3900)], {
      ingestId: ingest.id,
      timezone: "America/Los_Angeles",
    });
    expect(customIds).toEqual([]);
    const w = plans[0].workout;
    expect(w).toMatchObject({
      id: csvWorkoutId("Push Day", "2024-01-02T18:00"),
      source: "strong-csv",
      latestIngestId: ingest.id,
      strongSlug: null,
      startedLocal: "2024-01-02T18:00",
      startedAt: new Date("2024-01-03T02:00:00Z"),
      durationS: 3900,
      endedAt: new Date("2024-01-03T03:05:00Z"),
      workingSets: 2,
    });
    expect(plans[0].workoutExercises[0]).toMatchObject({ id: `${w.id}:0`, exerciseId: "bench-press-barbell" });
    expect(plans[0].sets).toHaveLength(2);
  });

  it("reports custom exercises so merges can be followed", () => {
    const { customIds } = planCsvWorkouts([workout("Odd", "2024-02-01T10:00", "Zercher Wobble Hold (Barbell)")], { ingestId: "ing_x" });
    expect(customIds).toHaveLength(1);
    const { plans } = planCsvWorkouts([workout("Odd", "2024-02-01T10:00", "Zercher Wobble Hold (Barbell)")], {
      ingestId: "ing_x",
      redirects: new Map([[customIds[0], "squat-barbell"]]),
    });
    expect(plans[0].workoutExercises[0].exerciseId).toBe("squat-barbell");
  });

  it("caps stored warnings", () => {
    const warnings = Array.from({ length: 500 }, (_, i) => ({ line: i, message: "bad row", text: "" }));
    expect(csvIngestRow(CSV, "ab".repeat(32), warnings).warnings).toHaveLength(200);
  });
});
