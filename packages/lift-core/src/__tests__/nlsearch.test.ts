import { describe, expect, it } from "vitest";
import { nlSearchExercises, parseExerciseQuery } from "../nlsearch";
import { searchExercises } from "../search";
import { EXERCISES } from "../catalog";
import type { Exercise } from "../types";

const top = (q: string, n = 1, opts?: Parameters<typeof nlSearchExercises>[1]) =>
  nlSearchExercises(q, opts).slice(0, n).map((r) => r.exercise.name);

describe("parseExerciseQuery", () => {
  it.each([
    ["chest dumbbell", { text: "", equipment: ["dumbbell"], muscles: ["chest"], category: null }],
    ["back exercises no equipment", { text: "", equipment: ["bodyweight"], muscles: ["lats", "upper_back", "lower_back"] }],
    ["cable shoulders", { equipment: ["cable"], muscles: ["front_delts", "side_delts", "rear_delts"] }],
    ["something for rear delts", { text: "", equipment: [], muscles: ["rear_delts"] }],
    ["leg machine", { equipment: ["machine"], muscles: ["quads", "hamstrings", "glutes", "calves"] }],
    ["bw core", { equipment: ["bodyweight", "weighted_bodyweight"], muscles: ["abs", "obliques"] }],
    ["smith machine legs", { equipment: ["smith"] }],
    ["ez bar biceps", { equipment: ["ez_bar"], muscles: ["biceps"] }],
    ["quads no machines", { equipment: [], excludeEquipment: ["machine"], muscles: ["quads"] }],
    ["chest stretches", { category: "stretching", muscles: ["chest"] }],
    ["machine chest press", { text: "press", equipment: ["machine"], muscles: ["chest"] }],
    ["incline db bench", { text: "incline bench", equipment: ["dumbbell"] }],
  ] as const)("%s", (q, expected) => {
    expect(parseExerciseQuery(q)).toMatchObject(expected);
  });

  it("plain words stay text", () => {
    expect(parseExerciseQuery("romanian deadlift")).toMatchObject({ text: "romanian deadlift", equipment: [], muscles: [], category: null });
  });
});

// [query, expected top result, how many top results to look in]
const CASES: [string, string | RegExp, number?][] = [
  ["chest dumbbell", "Bench Press (Dumbbell)"],
  ["back exercises no equipment", "Pull Up"],
  ["cable shoulders", "Lateral Raise (Cable)"],
  ["something for rear delts", /^Reverse Fly/],
  ["leg machine", /\(Machine\)$|^Leg Press$/],
  ["bw core", "Plank"],
  ["bodyweight chest", "Push Up"],
  ["biceps dumbbell", "Bicep Curl (Dumbbell)"],
  ["triceps cable", /^Triceps Pushdown \(Cable/],
  ["hamstrings machine", /Leg Curl \(Machine\)$/],
  ["glutes", "Hip Thrust (Barbell)"],
  ["calves", /^Calf Raise|Calf Raise/],
  ["abs", "Plank"],
  ["core exercises", "Plank"],
  ["lats", /^Pull Up|^Lat Pulldown/],
  ["traps", "Shrug (Barbell)"],
  ["forearms", /^Wrist Curl/],
  ["lower back", "Back Extension"],
  ["dumbbell shoulders", "Overhead Press (Dumbbell)"],
  ["upper chest dumbbell", "Incline Bench Press (Dumbbell)"],
  ["barbell back", "Bent Over Row (Barbell)"],
  ["ez bar biceps", "Bicep Curl (EZ Bar)"],
  ["cable rear delts", /^Reverse Fly \(Cable\)|^Face Pull/],
  ["kettlebell legs", /Goblet Squat|Swing/],
  ["band shoulders", /Band/],
  ["smith machine legs", "Squat (Smith Machine)"],
  ["chest stretch", /Stretch|Elbows Back/],
  ["plyometric legs", "Box Jump"],
  ["machine chest press", "Chest Press (Machine)"],
  ["dumbbells for arms", "Bicep Curl (Dumbbell)"],
  ["show me glute exercises with bands", /Band/],
  // plain name searches still behave like searchExercises
  ["back squat", "Squat (Barbell)"],
  ["leg press", "Leg Press"],
  ["leg curl", "Lying Leg Curl (Machine)"],
  ["shoulder press", /^Overhead Press/],
  ["bicep curl", /^Bicep Curl/],
  ["db bench", "Bench Press (Dumbbell)"],
  ["lateral raise cable", "Lateral Raise (Cable)"],
  ["bench", "Bench Press (Barbell)"],
  ["rdl", "Romanian Deadlift (Barbell)"],
  ["pull up", "Pull Up"],
  ["benhc pres", /^Bench Press/],
];

describe("nlSearchExercises", () => {
  it.each(CASES)("%s -> %s", (q, expected, n = 1) => {
    const names = top(q, n);
    expect(names.length).toBeGreaterThan(0);
    if (typeof expected === "string") expect(names).toContain(expected);
    else expect(names.some((x) => expected.test(x))).toBe(true);
  });

  it("covers 30+ queries", () => {
    expect(CASES.length).toBeGreaterThanOrEqual(30);
  });

  it("filters hold: every result matches the equipment and muscle terms", () => {
    for (const r of nlSearchExercises("chest dumbbell", { limit: 200 })) {
      expect(r.exercise.equipment).toBe("dumbbell");
      expect([...r.exercise.primary, ...r.exercise.secondary]).toContain("chest");
    }
    for (const r of nlSearchExercises("quads no machines", { limit: 200 })) expect(r.exercise.equipment).not.toBe("machine");
    for (const r of nlSearchExercises("back exercises no equipment", { limit: 200 })) expect(r.exercise.equipment).toBe("bodyweight");
  });

  it("stretches sink unless asked for", () => {
    const chest = nlSearchExercises("chest", { limit: 20 });
    expect(chest.every((r) => r.exercise.category !== "stretching")).toBe(true);
    const asked = nlSearchExercises("chest stretch", { limit: 5 });
    expect(asked.every((r) => r.exercise.category === "stretching")).toBe(true);
  });

  it("usage reorders within the structured results", () => {
    const id = EXERCISES.find((e) => e.name === "Chest Fly (Dumbbell)")!.id;
    expect(top("chest dumbbell", 1, { usage: { [id]: 40 } })).toEqual(["Chest Fly (Dumbbell)"]);
  });

  it("falls back to plain search when terms match nothing", () => {
    const catalog: Exercise[] = [
      { id: "x", name: "Zercher Squat", equipment: "barbell", category: "strength", tracking: "weight_reps", primary: ["quads"], secondary: [], aliases: [], curated: true },
    ];
    expect(nlSearchExercises("neck cable", { catalog }).length).toBe(searchExercises("neck cable", { catalog }).length);
    expect(top("zercher", 1, { catalog })).toEqual(["Zercher Squat"]);
  });

  it("an empty query browses like searchExercises", () => {
    expect(top("", 5)).toEqual(searchExercises("", { limit: 5 }).map((r) => r.exercise.name));
  });

  it("respects limit and reports the parse", () => {
    const r = nlSearchExercises("cable shoulders", { limit: 3 });
    expect(r).toHaveLength(3);
    expect(r[0]!.parsed.equipment).toEqual(["cable"]);
  });

  it("works on a catalog with custom exercises", () => {
    const custom: Exercise = {
      id: "custom-abc", name: "Belt Squat", equipment: "machine", category: "strength", tracking: "weight_reps", primary: ["quads", "glutes"], secondary: [], aliases: [], curated: false,
    };
    const catalog = [...EXERCISES, custom];
    expect(top("leg machine", 60, { catalog })).toContain("Belt Squat");
  });
});
