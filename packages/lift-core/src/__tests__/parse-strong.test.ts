import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { looksLikeStrongText, parseStrongDate, parseStrongText } from "../parse-strong";
import type { ParsedSet } from "../types";

function fixture(name: string): string {
  return readFileSync(path.join(__dirname, "fixtures", "strong", name), "utf8");
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

const EMPTY = {
  weight: null,
  unit: null,
  reps: null,
  durationS: null,
  distance: null,
  distanceUnit: null,
  rpe: null,
  bodyweight: false,
  note: null,
};

describe("parseStrongText: us push day", () => {
  const w = parseStrongText(fixture("us-push-day.txt"));

  it("reads the header and link", () => {
    expect(w.title).toBe("Push Day");
    expect(w.startedLocal).toBe("2026-11-04T18:12");
    expect(w.link).toBe("https://strong.app.link/AbCdEf123");
    expect(w.linkSlug).toBe("AbCdEf123");
    expect(w.notes).toEqual([]);
    expect(w.warnings).toEqual([]);
  });

  it("finds every exercise in order", () => {
    expect(w.exercises.map((e) => e.name)).toEqual([
      "Bench Press (Barbell)",
      "Overhead Press (Dumbbell)",
      "Pull Up",
      "Assisted Dip",
      "Plank",
      "Running (Treadmill)",
      "Farmer's Walk",
    ]);
  });

  it("parses bench sets with warm-up, rpe and drop tag", () => {
    const sets = w.exercises[0].sets;
    expect(sets.map((s) => s.position)).toEqual([0, 1, 2, 3]);
    expect(pick(sets[0])).toEqual({ ...EMPTY, kind: "warmup", label: 1, weight: 95, unit: "lb", reps: 10 });
    expect(pick(sets[1])).toEqual({ ...EMPTY, kind: "normal", label: 1, weight: 185, unit: "lb", reps: 5 });
    expect(pick(sets[2])).toEqual({ ...EMPTY, kind: "normal", label: 2, weight: 185, unit: "lb", reps: 5, rpe: 8 });
    expect(pick(sets[3])).toEqual({ ...EMPTY, kind: "drop", label: 3, weight: 165, unit: "lb", reps: 8 });
    expect(sets[2].raw).toBe("Set 2: 185 lb × 5 @ 8");
  });

  it("parses failure tag", () => {
    expect(w.exercises[1].sets[1].kind).toBe("failure");
    expect(w.exercises[1].sets[1].note).toBeNull();
  });

  it("parses bodyweight, weighted and assisted sets", () => {
    const [bw, weighted] = w.exercises[2].sets;
    expect(pick(bw)).toEqual({ ...EMPTY, kind: "normal", label: 1, reps: 12, bodyweight: true });
    expect(pick(weighted)).toEqual({ ...EMPTY, kind: "normal", label: 2, weight: 25, unit: "lb", reps: 8, bodyweight: true });
    const assisted = w.exercises[3].sets[0];
    expect(assisted.weight).toBe(-40);
    expect(assisted.bodyweight).toBe(true);
    expect(assisted.reps).toBe(10);
  });

  it("parses duration, distance+time and weight+distance", () => {
    expect(pick(w.exercises[4].sets[0])).toEqual({ ...EMPTY, kind: "normal", label: 1, durationS: 90 });
    expect(pick(w.exercises[5].sets[0])).toEqual({
      ...EMPTY,
      kind: "normal",
      label: 1,
      distance: 1.5,
      distanceUnit: "mi",
      durationS: 750,
    });
    expect(pick(w.exercises[6].sets[0])).toEqual({
      ...EMPTY,
      kind: "normal",
      label: 1,
      weight: 70,
      unit: "lb",
      distance: 40,
      distanceUnit: "m",
    });
  });

  it("is identical with crlf line endings", () => {
    const crlf = parseStrongText(fixture("us-push-day.txt").replace(/\r?\n/g, "\r\n"));
    expect(crlf).toEqual(w);
  });

  it("is detected", () => {
    expect(looksLikeStrongText(fixture("us-push-day.txt"))).toBe(true);
  });
});

describe("parseStrongText: en-gb kg", () => {
  const w = parseStrongText(fixture("en-gb-kg.txt"));

  it("reads a 24h en-gb date", () => {
    expect(w.title).toBe("Legs");
    expect(w.startedLocal).toBe("2026-11-04T18:12");
    expect(w.linkSlug).toBe("GbLegs42");
  });

  it("handles W: / W 2: warm-ups, comma decimals and kgs", () => {
    const sets = w.exercises[0].sets;
    expect(sets.map((s) => [s.kind, s.label])).toEqual([
      ["warmup", null],
      ["warmup", 2],
      ["normal", 1],
      ["normal", 2],
      ["normal", 3],
    ]);
    expect(sets.map((s) => s.weight)).toEqual([60, 80, 120, 122.5, 122.5]);
    expect(sets.every((s) => s.unit === "kg")).toBe(true);
    expect(sets[4].rpe).toBe(9);
    expect(sets[4].reps).toBe(4);
  });

  it("treats a comma before three digits as a thousands separator", () => {
    expect(w.exercises[1].sets.map((s) => s.weight)).toEqual([22.5, 22.5]);
    expect(w.exercises[2].sets[0].weight).toBe(1000);
    expect(w.exercises[2].sets[0].unit).toBe("lb");
  });

  it("has no warnings", () => {
    expect(w.warnings).toEqual([]);
  });
});

describe("parseStrongText: short date, emoji, query-string link", () => {
  const text = fixture("short-date-emoji.txt");

  it("parses the fixture", () => {
    const w = parseStrongText(text);
    expect(w.title).toBe("Upper 💪");
    expect(w.startedLocal).toBe("2026-11-04T18:12");
    expect(w.link).toBe("https://strong.app/workout/XyZ789?utm_source=share&ref=ios");
    expect(w.linkSlug).toBe("XyZ789");
    expect(w.exercises.map((e) => e.name)).toEqual(["Incline Bench Press (Dumbbell)", "Lat Pulldown (Cable)"]);
    expect(w.exercises[0].sets).toHaveLength(2);
    expect(w.warnings).toEqual([]);
  });

  it("tolerates non-breaking spaces, crlf and a narrow nbsp before PM", () => {
    const nb = text
      .replace("6:12 PM", "6:12 PM")
      .replace("Set 1: 65 lb", "Set 1: 65 lb")
      .replace(/\n/g, "\r\n");
    const w = parseStrongText(nb);
    expect(w.startedLocal).toBe("2026-11-04T18:12");
    expect(w.exercises[0].sets[0].weight).toBe(65);
    expect(w.exercises[0].sets[0].raw).toBe("Set 1: 65 lb × 10");
    expect(w.warnings).toEqual([]);
  });
});

describe("parseStrongText: warm-up and tag variants", () => {
  const w = parseStrongText(fixture("warmup-variants-no-link.txt"));
  const sets = w.exercises[0].sets;

  it("has no link", () => {
    expect(w.link).toBeNull();
    expect(w.linkSlug).toBeNull();
    expect(w.startedLocal).toBe("2026-11-03T07:05");
  });

  it("maps every prefix and tag to a kind", () => {
    expect(sets.map((s) => [s.kind, s.label])).toEqual([
      ["warmup", null],
      ["warmup", 1],
      ["warmup", null],
      ["normal", 1],
      ["warmup", 2],
      ["drop", 1],
      ["failure", 1],
      ["normal", 3],
    ]);
    expect(sets.map((s) => s.position)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("accepts x, X and * as the multiplier", () => {
    expect(sets.slice(0, 3).map((s) => [s.weight, s.reps])).toEqual([
      [135, 5],
      [185, 3],
      [225, 2],
    ]);
  });

  it("reads a decimal rpe without a space", () => {
    expect(sets[3].rpe).toBe(8.5);
  });

  it("keeps unknown tags as notes", () => {
    expect(sets[7].note).toBe("Paused");
    const row = w.exercises[1].sets[0];
    expect(row.kind).toBe("drop");
    expect(row.note).toBe("Tempo 3-1-1");
  });

  it("is detected without a link", () => {
    expect(looksLikeStrongText(fixture("warmup-variants-no-link.txt"))).toBe(true);
  });
});

describe("parseStrongText: notes", () => {
  const w = parseStrongText(fixture("notes.txt"));

  it("collects workout notes between the date and the first exercise", () => {
    expect(w.notes).toEqual(["Felt good, slept 8h.", "Gym was busy."]);
  });

  it("collects exercise notes", () => {
    expect(w.exercises.map((e) => [e.name, e.notes])).toEqual([
      ["Squat (Barbell)", ["Belt on for top sets"]],
      ["Chin Up", ["Keep scapula retracted"]],
    ]);
  });

  it("reads bare, plural and singular reps", () => {
    expect(w.exercises[1].sets.map((s) => s.reps)).toEqual([10, 9, 1]);
    expect(w.exercises[1].sets.every((s) => s.bodyweight && s.weight === null)).toBe(true);
    expect(w.warnings).toEqual([]);
  });

  it("separates workout notes from the first exercise even without a blank line", () => {
    const x = parseStrongText(
      "Quick\nMonday, November 3, 2026 at 6:00 AM\nshort one today\n\nCurl\nSet 1: 20 lb × 10\n",
    );
    expect(x.notes).toEqual(["short one today"]);
    expect(x.exercises[0].name).toBe("Curl");
  });
});

describe("parseStrongText: durations and distances", () => {
  const w = parseStrongText(fixture("cardio-durations.txt"));
  const byName = Object.fromEntries(w.exercises.map((e) => [e.name, e.sets]));

  it("reads every duration style", () => {
    expect(byName["Plank"].map((s) => s.durationS)).toEqual([45, 45, 90]);
    expect(byName["Cycling (Indoor)"][0].durationS).toBe(3723);
  });

  it("reads distance and time in either order", () => {
    expect(byName["Rowing (Machine)"].map((s) => [s.distance, s.distanceUnit, s.durationS])).toEqual([
      [2000, "m", 465],
      [2, "km", 450],
    ]);
    expect(byName["Cycling (Indoor)"][0].distanceUnit).toBe("mi");
    expect(byName["Sprint"][0]).toMatchObject({ distance: 300, distanceUnit: "ft", durationS: 12 });
  });

  it("reads weight and distance in either order", () => {
    expect(byName["Sled Push"].map((s) => [s.weight, s.unit, s.distance, s.distanceUnit])).toEqual([
      [90, "kg", 20, "yd"],
      [90, "kg", 40, "m"],
    ]);
  });

  it("reads weight × reps | time", () => {
    expect(byName["Weighted Carry"][0]).toMatchObject({ weight: 50, unit: "lb", reps: 1, durationS: 60 });
  });

  it("has no warnings", () => {
    expect(w.warnings).toEqual([]);
  });
});

describe("parseStrongText: garbage", () => {
  const w = parseStrongText(fixture("garbage-lines.txt"));

  it("trims the title and skips leading blanks", () => {
    expect(w.title).toBe("Messy Session");
    expect(w.startedLocal).toBe("2026-11-05T17:45");
  });

  it("keeps the good sets", () => {
    expect(w.exercises.map((e) => e.name)).toEqual(["Bench Press (Barbell)", "Cable Fly"]);
    const sets = w.exercises[0].sets;
    expect(sets.map((s) => s.label)).toEqual([1, 3, 4]);
    expect(sets.map((s) => s.position)).toEqual([0, 1, 2]);
    // "155 lb ×× five" keeps the readable part and notes the rest
    expect(sets[1].weight).toBe(155);
    expect(sets[1].note).toBe("×× five");
    expect(w.exercises[0].notes).toEqual([]);
  });

  it("warns with 1-based line numbers", () => {
    expect(w.warnings.map((x) => [x.line, x.text])).toEqual([
      [10, "???"],
      [11, "Set 2: banana"],
      [12, "Set 3: 155 lb ×× five"],
      [14, "185 lb xx 3"],
    ]);
  });
});

describe("parseStrongText: dates", () => {
  it("parses a date without weekday or 'at' and a 24h time", () => {
    const w = parseStrongText(fixture("no-weekday-24h.txt"));
    expect(w.startedLocal).toBe("2026-11-04T18:12");
    expect(w.warnings).toEqual([]);
  });

  it("returns null and warns on an unparseable date", () => {
    const w = parseStrongText(fixture("bad-date.txt"));
    expect(w.startedLocal).toBeNull();
    expect(w.title).toBe("Mystery Date");
    expect(w.warnings).toHaveLength(1);
    expect(w.warnings[0].line).toBe(2);
    expect(w.exercises).toHaveLength(1);
    expect(w.exercises[0].sets).toHaveLength(1);
  });

  it.each([
    ["Tuesday, November 4, 2026 at 6:12 PM", "2026-11-04T18:12"],
    ["Tuesday 4 November 2026 at 18:12", "2026-11-04T18:12"],
    ["Tue, Nov 4, 2026 at 6:12 PM", "2026-11-04T18:12"],
    ["November 4, 2026 at 6:12 PM", "2026-11-04T18:12"],
    ["Tuesday, November 4, 2026 6:12 PM", "2026-11-04T18:12"],
    ["4 Nov 2026, 06:05", "2026-11-04T06:05"],
    ["Wednesday, September 2, 2026 at 12:00 AM", "2026-09-02T00:00"],
    ["Sept 2, 2026 at 12:30 PM", "2026-09-02T12:30"],
    ["Saturday, January 1, 2028 at 11:59 p.m.", "2028-01-01T23:59"],
    ["2026-11-04 18:12", "2026-11-04T18:12"],
  ])("%s", (line, expected) => {
    expect(parseStrongDate(line)).toBe(expected);
  });

  it.each([
    "Push Day",
    "Bench Press (Barbell)",
    "February 30, 2026 at 6:00 PM",
    "November 4 at 6:12 PM",
    "Tuesday, November 4, 2026",
    "Set 1: 185 lb × 5",
    "13:00 PM November 4 2026",
  ])("rejects %s", (line) => {
    expect(parseStrongDate(line)).toBeNull();
  });

  it("warns when the date line is missing entirely", () => {
    const w = parseStrongText("Push\nBench Press\nSet 1: 100 lb × 5\n");
    expect(w.startedLocal).toBeNull();
    expect(w.exercises[0].name).toBe("Bench Press");
    expect(w.warnings.some((x) => x.line === 2)).toBe(true);
  });
});

describe("parseStrongText: inline variations", () => {
  const head = "T\nTuesday, November 4, 2026 at 6:12 PM\n\nEx\n";
  const one = (line: string) => parseStrongText(head + line + "\n").exercises[0]?.sets[0];

  it.each([
    ["Set 1: 100 lbs × 5", { weight: 100, unit: "lb", reps: 5 }],
    ["Set 1: 100 kgs x 5", { weight: 100, unit: "kg", reps: 5 }],
    ["Set 1: 100lb×5", { weight: 100, unit: "lb", reps: 5 }],
    ["Set 1: 12 rep", { reps: 12, bodyweight: true }],
    ["Set 1: 100 lb × 5 RPE 7.5", { rpe: 7.5, reps: 5 }],
    ["Set 1: 100 lb × 5 @ 9,5", { rpe: 9.5 }],
    ["Set 1: 0:45", { durationS: 45 }],
    ["Set 1: 2 min", { durationS: 120 }],
    ["Set 1: 5 km", { distance: 5, distanceUnit: "km" }],
    ["Set 1: 800 yd", { distance: 800, distanceUnit: "yd" }],
    ["Set 1: 400 m | 1:20", { distance: 400, distanceUnit: "m", durationS: 80 }],
    ["Set 1: 135 lb × 5 | 0:40", { weight: 135, reps: 5, durationS: 40 }],
    ["Set 1: +10 kg × 6", { weight: 10, unit: "kg", bodyweight: true }],
    ["Set 1: -30 lb × 8 [Failure]", { weight: -30, bodyweight: true, kind: "failure" }],
    ["Set 1: 100 lb × 5 [Warmup]", { kind: "warmup" }],
    ["W 3: 45 lb × 10", { kind: "warmup", label: 3 }],
    ["Warm-up 2: 45 lb × 10", { kind: "warmup", label: 2 }],
    ["Warm up: 45 lb × 10", { kind: "warmup", label: null }],
    ["D2: 50 lb × 8", { kind: "drop", label: 2 }],
    ["F3: 50 lb × 8", { kind: "failure", label: 3 }],
    ["set 2: 50 lb × 8", { kind: "normal", label: 2 }],
  ])("%s", (line, expected) => {
    expect(one(line)).toMatchObject(expected);
  });

  it("splits exercises that are not separated by a blank line", () => {
    const w = parseStrongText(head + "Set 1: 10 lb × 5\nCurl (Cable)\nSet 1: 20 lb × 5\n");
    expect(w.exercises.map((e) => e.name)).toEqual(["Ex", "Curl (Cable)"]);
  });

  it("keeps a stray blank line inside an exercise on the same exercise", () => {
    const w = parseStrongText(head + "Set 1: 10 lb × 5\n\nSet 2: 10 lb × 5\n");
    expect(w.exercises).toHaveLength(1);
    expect(w.exercises[0].sets.map((s) => s.position)).toEqual([0, 1]);
  });

  it("fills in a missing unit from the rest of the workout", () => {
    const w = parseStrongText(head + "Set 1: 80 kg × 5\nSet 2: 85 × 5\n");
    expect(w.exercises[0].sets[1]).toMatchObject({ weight: 85, unit: "kg", reps: 5 });
    expect(w.warnings).toHaveLength(1);
    expect(w.warnings[0].line).toBe(6);
  });

  it("finds the link on a shared line and with strong.app.link host", () => {
    const w = parseStrongText(head + "Set 1: 10 lb × 5\n\nCheck out my workout: https://strong.app.link/Zz9?x=1\n");
    expect(w.link).toBe("https://strong.app.link/Zz9?x=1");
    expect(w.linkSlug).toBe("Zz9");
  });

  it("never throws on odd input", () => {
    for (const t of ["", "\n\n\n", "   ", "Set 1:", "[[[", "×××", "W:", " ", head]) {
      expect(() => parseStrongText(t)).not.toThrow();
    }
    expect(parseStrongText("").exercises).toEqual([]);
    expect(parseStrongText("").warnings.length).toBeGreaterThan(0);
  });
});

describe("non-strong text", () => {
  it("parses to zero exercises with a warning", () => {
    const w = parseStrongText(fixture("not-strong.txt"));
    expect(w.exercises).toEqual([]);
    expect(w.warnings.length).toBeGreaterThan(0);
    expect(w.startedLocal).toBeNull();
  });

  it.each([
    fixture("not-strong.txt"),
    "lol",
    "",
    "W: 5",
    "Set 1: we start at noon",
    "Meeting notes\nSet 1: agenda\nSet 2: questions",
    "Tuesday, November 4, 2026 at 6:12 PM — dinner?",
    "just did 185 lb × 5 on bench!",
  ])("looksLikeStrongText false: %s", (t) => {
    expect(looksLikeStrongText(t)).toBe(false);
  });

  it.each([
    "us-push-day.txt",
    "en-gb-kg.txt",
    "short-date-emoji.txt",
    "warmup-variants-no-link.txt",
    "notes.txt",
    "cardio-durations.txt",
    "garbage-lines.txt",
    "no-weekday-24h.txt",
    "bad-date.txt",
  ])("looksLikeStrongText true: %s", (name) => {
    expect(looksLikeStrongText(fixture(name))).toBe(true);
  });

  it("detects a share with only a date and one set", () => {
    expect(looksLikeStrongText("Arms\nNov 4, 2026 at 6:12 PM\n\nCurl\nSet 1: 20 lb × 10")).toBe(true);
  });
});
