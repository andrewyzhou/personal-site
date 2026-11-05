import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseWorkoutCsv, parseWorkoutCsvDate, parseCsvDuration } from "../parse-workout-csv";
import { summarizeWorkout } from "../math";
import type { ParsedSet } from "../types";

// checkouts may rewrite line endings, so normalise to lf and let tests add crlf themselves
function fixture(name: string): string {
  return readFileSync(path.join(__dirname, "fixtures", "workout-csv", name), "utf8").replace(/\r\n/g, "\n");
}

function pick(s: ParsedSet) {
  return {
    kind: s.kind,
    label: s.label,
    weight: s.weight,
    unit: s.unit,
    reps: s.reps,
    durationS: s.durationS,
    distance: s.distance,
    distanceUnit: s.distanceUnit,
    rpe: s.rpe,
    bodyweight: s.bodyweight,
    note: s.note,
  };
}

const HEADER = "Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE";

describe("parseWorkoutCsv: modern quoted export", () => {
  const { workouts, warnings } = parseWorkoutCsv(fixture("modern.csv"));

  it("groups by date + workout name, oldest first", () => {
    expect(warnings).toEqual([]);
    expect(workouts.map((w) => [w.title, w.startedLocal])).toEqual([
      ["Push Day", "2024-03-14T18:30"],
      ["Pull Day", "2024-03-16T09:05"],
    ]);
    for (const w of workouts) {
      expect(w.link).toBeNull();
      expect(w.linkSlug).toBeNull();
      expect(w.warnings).toEqual([]);
    }
  });

  it("reads the workout duration", () => {
    expect(workouts[0].durationS).toBe(3900);
    expect(workouts[1].durationS).toBe(2700);
  });

  it("keeps workout notes once, with embedded newlines split into lines", () => {
    expect(workouts[0].notes).toEqual(["Felt strong, slept 8h", "second line of notes"]);
    expect(workouts[1].notes).toEqual([]);
  });

  it("splits exercises on consecutive names", () => {
    const push = workouts[0];
    expect(push.exercises.map((e) => [e.name, e.sets.length])).toEqual([
      ["Bench Press (Barbell)", 4],
      ["Plank", 1],
      ["Bench Press (Barbell)", 1],
    ]);
    expect(push.exercises.every((e) => e.notes.length === 0)).toBe(true);
  });

  it("maps set order, weight, reps, rpe and notes", () => {
    const bench = workouts[0].exercises[0].sets;
    expect(bench.map((s) => s.position)).toEqual([0, 1, 2, 3]);
    expect(bench.map(pick)).toEqual([
      { kind: "warmup", label: null, weight: 45, unit: "lb", reps: 10, durationS: null, distance: null, distanceUnit: null, rpe: null, bodyweight: false, note: null },
      { kind: "normal", label: 1, weight: 135, unit: "lb", reps: 8, durationS: null, distance: null, distanceUnit: null, rpe: 8, bodyweight: false, note: 'paused, "touch and go" after' },
      { kind: "normal", label: 2, weight: 155.5, unit: "lb", reps: 5, durationS: null, distance: null, distanceUnit: null, rpe: 8.5, bodyweight: false, note: null },
      { kind: "drop", label: null, weight: 95, unit: "lb", reps: 12, durationS: null, distance: null, distanceUnit: null, rpe: null, bodyweight: false, note: null },
    ]);
    const fail = workouts[0].exercises[2].sets[0];
    expect(fail.position).toBe(0);
    expect(pick(fail)).toMatchObject({ kind: "failure", weight: 135, reps: 3, rpe: 10 });
  });

  it("treats zero weight with reps as bodyweight and seconds/distance as timed sets", () => {
    const plank = workouts[0].exercises[1].sets[0];
    expect(pick(plank)).toMatchObject({ weight: null, unit: null, reps: null, durationS: 60, bodyweight: false });
    const [pull1, pull2] = workouts[1].exercises[0].sets;
    expect(pick(pull1)).toMatchObject({ weight: null, unit: null, reps: 10, bodyweight: true });
    expect(pick(pull2)).toMatchObject({ weight: 25, unit: "lb", reps: 6, rpe: 9 });
    const run = workouts[1].exercises[1].sets[0];
    expect(pick(run)).toMatchObject({ weight: null, reps: null, distance: 1.5, distanceUnit: "mi", durationS: 720, note: "easy pace" });
  });

  it("keeps the raw record text and works with summarizeWorkout", () => {
    expect(workouts[1].exercises[0].sets[0].raw).toBe('"2024-03-16 09:05:00","Pull Day","45m","Pull Up","1","0","10","0","0","","",""');
    const sum = summarizeWorkout(workouts[0]);
    expect(sum.workingSets).toBe(5);
    expect(sum.unit).toBe("lb");
  });

  it("uses the unit options", () => {
    const kg = parseWorkoutCsv(fixture("modern.csv"), { weightUnit: "kg", distanceUnit: "km" });
    expect(kg.workouts[0].exercises[0].sets[1].unit).toBe("kg");
    expect(kg.workouts[1].exercises[1].sets[0].distanceUnit).toBe("km");
  });

  it("is unaffected by a bom, crlf or doubled carriage returns", () => {
    const base = fixture("modern.csv");
    const expected = JSON.parse(JSON.stringify(workouts.map((w) => ({ ...w, exercises: w.exercises.map((e) => ({ ...e, sets: e.sets.map(pick) })) }))));
    for (const variant of ["﻿" + base, base.replace(/\n/g, "\r\n"), "﻿" + base.replace(/\n/g, "\r\r\n"), base.replace(/\n/g, "\r")]) {
      const res = parseWorkoutCsv(variant);
      expect(res.warnings).toEqual([]);
      const got = res.workouts.map((w) => ({ ...w, exercises: w.exercises.map((e) => ({ ...e, sets: e.sets.map(pick) })) }));
      expect(got).toEqual(expected);
    }
  });
});

describe("parseWorkoutCsv: legacy semicolon export", () => {
  const { workouts, warnings } = parseWorkoutCsv(fixture("legacy-semicolon.csv"));

  it("parses unit columns, decimal commas and workout duration", () => {
    expect(warnings).toEqual([]);
    expect(workouts).toHaveLength(1);
    const w = workouts[0];
    expect(w.title).toBe("Leg Day");
    expect(w.startedLocal).toBe("2019-05-11T07:12");
    expect(w.durationS).toBe(3600);
    expect(w.exercises.map((e) => e.name)).toEqual(["Squat (Barbell)", "Rowing (Machine)", "Calf Raise (Machine)"]);
    const squat = w.exercises[0].sets.map(pick);
    expect(squat[0]).toMatchObject({ kind: "warmup", label: 1, weight: 60, unit: "kg", reps: 5 });
    expect(squat[1]).toMatchObject({ kind: "normal", label: 1, weight: 102.5, unit: "kg" });
    expect(squat[2].note).toBe("form; check");
    expect(pick(w.exercises[1].sets[0])).toMatchObject({ distance: 2000, distanceUnit: "m", durationS: 480, weight: null, reps: null });
    // the row's own unit column wins over the option
    expect(pick(w.exercises[2].sets[0])).toMatchObject({ weight: 100, unit: "lb", reps: 15 });
    expect(parseWorkoutCsv(fixture("legacy-semicolon.csv"), { weightUnit: "lb" }).workouts[0].exercises[0].sets[0].unit).toBe("kg");
  });
});

describe("parseWorkoutCsv: messy input", () => {
  const { workouts, warnings } = parseWorkoutCsv(fixture("messy.csv"));

  it("keeps good rows and turns bad ones into warnings", () => {
    expect(workouts.map((w) => w.title)).toEqual(["Morning", "Mystery"]);
    const morning = workouts[0];
    expect(morning.exercises.map((e) => [e.name, e.sets.map((s) => s.weight)])).toEqual([
      ["Deadlift (Barbell)", [315]],
      ["Row (Barbell)", [185]],
      ["Deadlift (Barbell)", [335]],
    ]);
    expect(morning.exercises[1].sets[0].rpe).toBeNull();
    expect(warnings.map((w) => [w.line, w.message])).toEqual([
      [4, 'unrecognised set order "X9"'],
      [5, 'unreadable weight "abc"'],
      [6, "set has no weight, reps, time or distance"],
      [8, "row without an exercise name"],
      [9, "unreadable date"],
      [9, "unreadable duration"],
      [10, 'rpe out of range "15"'],
    ]);
    expect(morning.warnings).toHaveLength(5);
  });

  it("keeps an undated workout last with a null start", () => {
    const mystery = workouts[1];
    expect(mystery.startedLocal).toBeNull();
    expect(mystery.durationS).toBeNull();
    expect(mystery.exercises[0].sets[0].weight).toBe(30);
    expect(mystery.warnings.map((w) => w.message)).toEqual(["unreadable date", "unreadable duration"]);
  });
});

describe("parseWorkoutCsv: quoting and structure", () => {
  it("handles embedded delimiters, quotes and newlines and reports start lines", () => {
    const csv = [
      HEADER,
      `"2024-05-01 10:00:00","A, ""quoted"" name","","Curl (Cable)","1","20","12","0","0","line one`,
      `line two, still note","",""`,
      `"2024-05-01 10:00:00","A, ""quoted"" name","","Curl (Cable)","2","20","nope","0","0","","",""`,
    ].join("\n");
    const res = parseWorkoutCsv(csv);
    expect(res.workouts[0].title).toBe('A, "quoted" name');
    expect(res.workouts[0].durationS).toBeNull();
    expect(res.workouts[0].exercises[0].sets[0].note).toBe("line one\nline two, still note");
    expect(res.warnings).toEqual([{ line: 4, message: 'unreadable reps "nope"', text: expect.stringContaining("nope") }]);
  });

  it("merges non-adjacent rows of the same workout", () => {
    const csv = [
      HEADER,
      "2024-05-01 10:00:00,A,,Curl (Cable),1,20,12,0,0,,,",
      "2024-05-02 10:00:00,B,,Squat (Barbell),1,200,5,0,0,,,",
      "2024-05-01 10:00:00,A,,Curl (Cable),2,20,10,0,0,,,",
    ].join("\n");
    const { workouts } = parseWorkoutCsv(csv);
    expect(workouts.map((w) => w.title)).toEqual(["A", "B"]);
    expect(workouts[0].exercises).toHaveLength(1);
    expect(workouts[0].exercises[0].sets.map((s) => [s.position, s.reps])).toEqual([
      [0, 12],
      [1, 10],
    ]);
  });

  it("separates same-name workouts on different dates, and same-date workouts by name", () => {
    const csv = [
      HEADER,
      "2024-05-02 10:00:00,A,,Curl (Cable),1,20,12,0,0,,,",
      "2024-05-01 10:00:00,A,,Curl (Cable),1,20,12,0,0,,,",
      "2024-05-01 10:00:00,B,,Curl (Cable),1,20,12,0,0,,,",
    ].join("\n");
    const { workouts } = parseWorkoutCsv(csv);
    expect(workouts.map((w) => [w.startedLocal, w.title])).toEqual([
      ["2024-05-01T10:00", "A"],
      ["2024-05-01T10:00", "B"],
      ["2024-05-02T10:00", "A"],
    ]);
  });

  it("accepts columns in any order, short rows and unquoted fields", () => {
    const csv = ["Exercise Name,Reps,Date,Set Order,Weight", "Dip,8,2024-01-01 08:00:00,1", "Dip,6,2024-01-01 08:00:00,2,-20"].join("\n");
    const { workouts, warnings } = parseWorkoutCsv(csv);
    expect(warnings).toEqual([]);
    const [a, b] = workouts[0].exercises[0].sets;
    expect(workouts[0].title).toBe("");
    expect(pick(a)).toMatchObject({ weight: null, reps: 8, bodyweight: true });
    // assisted sets can come through as negative load
    expect(pick(b)).toMatchObject({ weight: -20, unit: "lb", reps: 6, bodyweight: true });
  });

  it("skips rest timer rows and blank lines silently", () => {
    const csv = [HEADER, "", "2024-01-01 08:00:00,A,,Bench Press (Barbell),Rest Timer,0,0,0,120,,,", "2024-01-01 08:00:00,A,,Bench Press (Barbell),1,100,5,0,0,,,", "", ""].join("\n");
    const { workouts, warnings } = parseWorkoutCsv(csv);
    expect(warnings).toEqual([]);
    expect(workouts[0].exercises[0].sets).toHaveLength(1);
  });

  it("reads numeric-with-letter set orders", () => {
    const rows = ["W", "W2", "2W", "D", "3D", "F", "F4", "7"].map((o, i) => `2024-01-01 08:00:00,A,,Squat (Barbell),${o},100,${i + 1},0,0,,,`);
    const sets = parseWorkoutCsv([HEADER, ...rows].join("\n")).workouts[0].exercises[0].sets;
    expect(sets.map((s) => [s.kind, s.label])).toEqual([
      ["warmup", null],
      ["warmup", 2],
      ["warmup", 2],
      ["drop", null],
      ["drop", 3],
      ["failure", null],
      ["failure", 4],
      ["normal", 7],
    ]);
  });

  it("warns on an unterminated quote but keeps what it read", () => {
    const csv = `${HEADER}\n2024-01-01 08:00:00,A,,Squat (Barbell),1,100,5,0,0,"oops`;
    const res = parseWorkoutCsv(csv);
    expect(res.warnings.map((w) => w.message)).toEqual(["unterminated quoted field"]);
    expect(res.workouts[0].exercises[0].sets[0].note).toBe("oops");
  });

  it("rejects text that isn't an export", () => {
    expect(parseWorkoutCsv("")).toEqual({ workouts: [], warnings: [] });
    expect(parseWorkoutCsv("\n\n")).toEqual({ workouts: [], warnings: [] });
    const res = parseWorkoutCsv("name,age\nbob,3");
    expect(res.workouts).toEqual([]);
    expect(res.warnings[0]).toMatchObject({ line: 1, message: expect.stringContaining("not a workout csv export") });
  });

  it("detects tab separated exports", () => {
    const csv = [HEADER.replace(/,/g, "\t"), ["2024-01-01 08:00:00", "A", "", "Squat (Barbell)", "1", "100", "5"].join("\t")].join("\n");
    expect(parseWorkoutCsv(csv).workouts[0].exercises[0].sets[0].weight).toBe(100);
  });

  it("handles a large export quickly", () => {
    const rows: string[] = [HEADER];
    for (let d = 0; d < 400; d++) {
      const date = new Date(Date.UTC(2020, 0, 1 + d)).toISOString().slice(0, 10);
      for (let s = 1; s <= 20; s++) rows.push(`"${date} 07:00:00","Day","1h","Squat (Barbell)","${s}","225","5","0","0","","",""`);
    }
    const { workouts } = parseWorkoutCsv(rows.join("\r\n"));
    expect(workouts).toHaveLength(400);
    expect(workouts[0].startedLocal).toBe("2020-01-01T07:00");
    expect(workouts[399].exercises[0].sets).toHaveLength(20);
  });
});

describe("parseWorkoutCsvDate", () => {
  it.each([
    ["2024-03-14 18:30:00", "2024-03-14T18:30"],
    ["2024-03-14 18:30", "2024-03-14T18:30"],
    ["2024-03-14T08:05:59", "2024-03-14T08:05"],
    ["2024-3-4 8:05:00", "2024-03-04T08:05"],
    ["2024-03-14", "2024-03-14T00:00"],
    ["3/14/2024 6:30 PM", "2024-03-14T18:30"],
    ["3/14/2024 12:10 AM", "2024-03-14T00:10"],
    ["Thursday, March 14, 2024 at 6:30 PM", "2024-03-14T18:30"],
    ["2024-02-30 10:00:00", null],
    ["2024-13-01 10:00:00", null],
    ["2024-01-01 24:00:00", null],
    ["", null],
    ["soon", null],
  ])("%j -> %j", (input, out) => {
    expect(parseWorkoutCsvDate(input)).toBe(out);
  });
});

describe("parseCsvDuration", () => {
  it.each([
    ["1h 5m", 3900],
    ["45m", 2700],
    ["1h", 3600],
    ["2h 0m", 7200],
    ["1h 5m 30s", 3930],
    ["50s", 50],
    ["1:05:00", 3900],
    ["45:10", 2710],
    ["3900", 3900],
    ["", null],
    ["soon", null],
    ["1h x", null],
  ])("%j -> %j", (input, out) => {
    expect(parseCsvDuration(input)).toBe(out);
  });
});
