import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db", () => ({}));

import { parseWorkoutCsv, parseCsvDuration } from "lift-core";
import {
  EXPORT_VERSION,
  WORKOUT_CSV_HEADER,
  assembleExport,
  chunkStream,
  exportJsonChunks,
  workoutCsvLines,
  csvDuration,
  toExportJson,
  toWorkoutCsv,
  type ExerciseRowIn,
  type ExportSet,
  type SetRowIn,
  type WorkoutRowIn,
} from "@/lib/lift/export";

function wRow(p: Partial<WorkoutRowIn> & Pick<WorkoutRowIn, "id" | "title" | "startedLocal">): WorkoutRowIn {
  return {
    startedAt: null,
    endedAt: null,
    durationS: null,
    notes: null,
    source: "share-text",
    status: "finished",
    workingSets: 0,
    volumeKg: 0,
    ...p,
  };
}

function eRow(workoutId: string, position: number, name: string, extra: Partial<ExerciseRowIn> = {}): ExerciseRowIn {
  return {
    id: `${workoutId}:${position}`,
    workoutId,
    exerciseId: name.toLowerCase().replace(/[^a-z]+/g, "-"),
    name,
    nameRaw: name,
    position,
    notes: null,
    supersetGroup: null,
    restS: null,
    ...extra,
  };
}

function sRow(workoutExerciseId: string, position: number, s: Partial<ExportSet>): SetRowIn {
  return {
    workoutExerciseId,
    position,
    kind: "normal",
    weight: null,
    unit: null,
    weightKg: null,
    reps: null,
    durationS: null,
    distanceM: null,
    rpe: null,
    bodyweight: false,
    note: null,
    completed: true,
    e1rmKg: null,
    ...s,
  };
}

const WORKOUTS = [
  wRow({
    id: "share-b",
    title: "Legs, \"heavy\"",
    startedLocal: "2026-11-02T19:18",
    durationS: 3912,
    notes: "felt good\nknee a bit sore",
    startedAt: new Date("2026-11-03T03:18:00Z"),
  }),
  wRow({ id: "share-a", title: "Push Day", startedLocal: "2026-10-27T18:00", durationS: 2700 }),
  wRow({ id: "app-empty", title: "Empty", startedLocal: "2026-10-28T08:00", status: "active" }),
];
const EXERCISES = [
  eRow("share-a", 0, "Bench Press (Barbell)", { notes: "pause reps" }),
  eRow("share-a", 1, "Pull Up"),
  eRow("share-b", 1, "Rowing (Machine)"),
  eRow("share-b", 0, "Squat (Barbell)"),
  eRow("gone", 0, "Orphan"),
];
const SETS = [
  sRow("share-a:0", 1, { weight: 185, unit: "lb", reps: 5, rpe: 8 }),
  sRow("share-a:0", 0, { kind: "warmup", weight: 135, unit: "lb", reps: 5 }),
  sRow("share-a:0", 2, { weight: 185, unit: "lb", reps: 5, note: "grindy, but ok" }),
  sRow("share-a:0", 3, { kind: "drop", weight: 135, unit: "lb", reps: 10 }),
  sRow("share-a:0", 4, { weight: 205, unit: "lb", reps: 1, completed: false }),
  sRow("share-a:1", 0, { reps: 10, bodyweight: true }),
  sRow("share-a:1", 1, { weight: -40, unit: "lb", reps: 8, bodyweight: true }),
  sRow("share-a:1", 2, { kind: "failure", reps: 6, bodyweight: true }),
  sRow("share-b:0", 0, { weight: 100, unit: "kg", reps: 5 }),
  sRow("share-b:0", 1, { weight: 102.5, unit: "kg", reps: 3, rpe: 9.5 }),
  sRow("share-b:1", 0, { distanceM: 2000, durationS: 480 }),
  sRow("missing:0", 0, { weight: 1, unit: "lb", reps: 1 }),
];

describe("assembleExport", () => {
  it("nests rows in order and drops orphans", () => {
    const out = assembleExport(WORKOUTS, EXERCISES, SETS);
    expect(out.map((w) => w.id)).toEqual(["share-a", "app-empty", "share-b"]);
    expect(out[0].exercises.map((e) => e.name)).toEqual(["Bench Press (Barbell)", "Pull Up"]);
    expect(out[0].exercises[0].sets.map((s) => s.position)).toEqual([0, 1, 2, 3, 4]);
    expect(out[0].exercises[0].notes).toBe("pause reps");
    expect(out[2].exercises.map((e) => e.name)).toEqual(["Squat (Barbell)", "Rowing (Machine)"]);
    expect(out[2].startedAt).toBe("2026-11-03T03:18:00.000Z");
    expect(out[1].exercises).toEqual([]);
    expect(JSON.stringify(out)).not.toContain("Orphan");
  });
});

describe("json export", () => {
  it("is versioned and counts what it carries", () => {
    const doc = toExportJson(assembleExport(WORKOUTS, EXERCISES, SETS), new Date("2026-11-04T20:00:00Z"), "America/Los_Angeles");
    expect(doc.version).toBe(EXPORT_VERSION);
    expect(doc).toMatchObject({
      version: 1,
      exportedAt: "2026-11-04T20:00:00.000Z",
      timezone: "America/Los_Angeles",
      counts: { workouts: 3, exercises: 4, sets: 11 },
    });
    // notes are part of the owner's own export
    expect(doc.workouts[2].notes).toBe("felt good\nknee a bit sore");
    expect(doc.workouts[0].exercises[0].sets[4]).toMatchObject({ completed: false, weight: 205 });
    expect(JSON.parse(JSON.stringify(doc))).toEqual(doc);
  });
});

describe("workout csv export", () => {
  it("durations read back exactly", () => {
    for (const s of [0, 30, 59, 60, 2700, 3600, 3912, 7261]) expect(parseCsvDuration(csvDuration(s))).toBe(s);
    expect(csvDuration(3900)).toBe("1h 5m");
    expect(csvDuration(2700)).toBe("45m");
    expect(csvDuration(null)).toBe("");
  });

  it("writes the export columns, quoting where needed", () => {
    const csv = toWorkoutCsv(assembleExport(WORKOUTS, EXERCISES, SETS));
    const lines = csv.trimEnd().split("\n");
    expect(lines[0]).toBe(WORKOUT_CSV_HEADER.join(","));
    expect(WORKOUT_CSV_HEADER.slice(0, 12)).toEqual([
      "Date", "Workout Name", "Duration", "Exercise Name", "Set Order", "Weight", "Reps", "Distance", "Seconds", "Notes", "Workout Notes", "RPE",
    ]);
    expect(lines[1]).toBe("2026-10-27 18:00:00,Push Day,45m,Bench Press (Barbell),W,135,5,0,0,,,,lb,");
    expect(lines[2]).toBe("2026-10-27 18:00:00,Push Day,45m,Bench Press (Barbell),1,185,5,0,0,,,8,lb,");
    expect(lines[3]).toBe('2026-10-27 18:00:00,Push Day,45m,Bench Press (Barbell),2,185,5,0,0,"grindy, but ok",,,lb,');
    expect(lines[4]).toMatch(/,D,135,10,/);
    // the unfinished set and the empty workout have no rows
    expect(csv).not.toContain(",205,");
    expect(csv).not.toContain("Empty");
    expect(csv).toContain('"Legs, ""heavy"""');
    expect(csv).toContain('"felt good\nknee a bit sore"');
  });

  it("round-trips through parseWorkoutCsv", () => {
    const exported = assembleExport(WORKOUTS, EXERCISES, SETS);
    const { workouts, warnings } = parseWorkoutCsv(toWorkoutCsv(exported));
    expect(warnings).toEqual([]);
    expect(workouts).toHaveLength(2);

    const [push, legs] = workouts;
    expect(push).toMatchObject({ title: "Push Day", startedLocal: "2026-10-27T18:00", durationS: 2700, notes: [] });
    expect(legs).toMatchObject({
      title: 'Legs, "heavy"',
      startedLocal: "2026-11-02T19:18",
      durationS: 3912,
      notes: ["felt good", "knee a bit sore"],
    });

    // every completed set comes back with the same numbers, kind and unit
    for (const [i, parsed] of workouts.entries()) {
      const source = exported.filter((w) => w.exercises.some((e) => e.sets.some((s) => s.completed)))[i];
      expect(parsed.exercises.map((e) => e.name)).toEqual(source.exercises.map((e) => e.nameRaw));
      parsed.exercises.forEach((pe, j) => {
        const want = source.exercises[j].sets.filter((s) => s.completed);
        expect(pe.sets.map((s) => ({ kind: s.kind, weight: s.weight, unit: s.unit, reps: s.reps, durationS: s.durationS, rpe: s.rpe, note: s.note }))).toEqual(
          want.map((s) => ({ kind: s.kind, weight: s.weight, unit: s.weight === null ? null : s.unit, reps: s.reps, durationS: s.durationS, rpe: s.rpe, note: s.note })),
        );
        pe.sets.forEach((s, k) => {
          if (want[k].distanceM !== null) {
            expect(s.distanceUnit).toBe("m");
            expect(s.distance).toBe(want[k].distanceM);
          }
        });
      });
    }

    // bodyweight and assisted sets keep their meaning
    const pull = push.exercises[1].sets;
    expect(pull.map((s) => s.bodyweight)).toEqual([true, true, true]);
    expect(pull[1].weight).toBe(-40);
    // kg survives without telling the parser the unit
    expect(legs.exercises[0].sets.map((s) => `${s.weight} ${s.unit}`)).toEqual(["100 kg", "102.5 kg"]);
  });

  it("an empty export is just the header", () => {
    expect(toWorkoutCsv([])).toBe(WORKOUT_CSV_HEADER.join(",") + "\n");
    expect(parseWorkoutCsv(toWorkoutCsv([]))).toEqual({ workouts: [], warnings: [] });
  });

  it("leaves out active and discarded workouts, even with completed sets; json keeps them", () => {
    const workouts = [
      wRow({ id: "live", title: "Still Going", startedLocal: "2026-11-04T07:00", status: "active" }),
      wRow({ id: "binned", title: "Tossed", startedLocal: "2026-11-03T07:00", status: "discarded" }),
      wRow({ id: "done", title: "Done", startedLocal: "2026-11-02T07:00" }),
    ];
    const exs = workouts.map((w) => eRow(w.id, 0, "Squat (Barbell)"));
    const sets = workouts.map((w) => sRow(`${w.id}:0`, 0, { weight: 100, unit: "kg", reps: 5 }));
    const exported = assembleExport(workouts, exs, sets);
    const csv = toWorkoutCsv(exported);
    expect(csv).toContain("Done");
    expect(csv).not.toContain("Still Going");
    expect(csv).not.toContain("Tossed");
    expect(parseWorkoutCsv(csv).workouts).toHaveLength(1);
    const doc = toExportJson(exported, new Date(0), "UTC");
    expect(doc.workouts.map((w) => [w.id, w.status])).toEqual([["done", "finished"], ["binned", "discarded"], ["live", "active"]]);
  });
});

async function drain(stream: ReadableStream<Uint8Array>): Promise<{ text: string; chunks: number }> {
  const reader = stream.getReader();
  const dec = new TextDecoder();
  let text = "";
  let chunks = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks++;
    text += dec.decode(value, { stream: true });
  }
  return { text: text + dec.decode(), chunks };
}

describe("streamed export", () => {
  const exported = assembleExport(WORKOUTS, EXERCISES, SETS);
  const at = new Date("2026-11-04T20:00:00Z");

  it("csv streams the same bytes the builder makes", async () => {
    expect([...workoutCsvLines(exported)].join("")).toBe(toWorkoutCsv(exported));
    expect((await drain(chunkStream(workoutCsvLines(exported)))).text).toBe(toWorkoutCsv(exported));
    expect((await drain(chunkStream(workoutCsvLines([])))).text).toBe(toWorkoutCsv([]));
  });

  it("json streams the same document, compact", async () => {
    const { text } = await drain(chunkStream(exportJsonChunks(exported, at, "America/Los_Angeles")));
    expect(text).toBe(JSON.stringify(toExportJson(exported, at, "America/Los_Angeles")));
    expect(JSON.parse(text)).toEqual(toExportJson(exported, at, "America/Los_Angeles"));
    const empty = await drain(chunkStream(exportJsonChunks([], at, "UTC")));
    expect(JSON.parse(empty.text)).toEqual(toExportJson([], at, "UTC"));
  });

  it("a big export arrives in several chunks, not one string", async () => {
    const many = Array.from({ length: 3000 }, (_, i) => ({ ...exported[0], id: `w${i}` }));
    const { text, chunks } = await drain(chunkStream(workoutCsvLines(many)));
    expect(chunks).toBeGreaterThan(1);
    expect(text).toBe(toWorkoutCsv(many));
  });

  it("utf-8 survives chunk boundaries", async () => {
    const { text } = await drain(chunkStream(["é".repeat(70_000), "ü"]));
    expect(text).toBe("é".repeat(70_000) + "ü");
  });
});
