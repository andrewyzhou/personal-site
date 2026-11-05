import { describe, expect, it } from "vitest";
import {
  CURATED_EXERCISES,
  EXERCISES,
  FREE_DB_ENTRIES,
  getExercise,
  looseKey,
  normalizeName,
  resolveExerciseName,
} from "../catalog";
import { MUSCLE_REGIONS } from "../muscles";
import type { Exercise } from "../types";

const SHARE_NAMES = [
  "Bench Press (Barbell)",
  "Incline Bench Press (Dumbbell)",
  "Squat (Barbell)",
  "Deadlift (Barbell)",
  "Romanian Deadlift (Barbell)",
  "Overhead Press (Barbell)",
  "Overhead Press (Dumbbell)",
  "Lateral Raise (Dumbbell)",
  "Lateral Raise (Cable)",
  "Reverse Fly (Dumbbell)",
  "Face Pull (Cable)",
  "Lat Pulldown (Cable)",
  "Seated Row (Cable)",
  "Bent Over Row (Barbell)",
  "Pull Up",
  "Chin Up",
  "Pull Up (Assisted)",
  "Bicep Curl (Dumbbell)",
  "Hammer Curl (Dumbbell)",
  "Triceps Pushdown (Cable - Straight Bar)",
  "Triceps Extension (Cable)",
  "Skullcrusher (Barbell)",
  "Leg Press",
  "Leg Extension (Machine)",
  "Lying Leg Curl (Machine)",
  "Seated Leg Curl (Machine)",
  "Hip Thrust (Barbell)",
  "Bulgarian Split Squat",
  "Calf Raise (Machine)",
  "Standing Calf Raise (Dumbbell)",
  "Chest Fly (Dumbbell)",
  "Chest Press (Machine)",
  "Shoulder Press (Machine)",
  "Shrug (Dumbbell)",
  "Plank",
  "Crunch",
  "Hanging Leg Raise",
  "Cable Crunch",
  "Push Up",
  "Chest Dip",
  "Running (Treadmill)",
  "Cycling (Indoor)",
  "Rowing (Machine)",
  "Farmer's Walk",
];

const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;

describe("normalizeName", () => {
  it("lowercases and turns parens and punctuation into spaces", () => {
    expect(normalizeName("Bench Press (Barbell)")).toBe("bench press barbell");
    expect(normalizeName("Triceps Pushdown (Cable - Straight Bar)")).toBe("triceps pushdown cable straight bar");
    expect(normalizeName("  Pull-Up  ")).toBe("pull up");
  });

  it("unifies unicode spaces, apostrophes and the multiplication sign", () => {
    expect(normalizeName("Farmer’s Walk")).toBe("farmers walk");
    expect(normalizeName("Farmer's Walk")).toBe("farmers walk");
    expect(normalizeName("3×10 Squat")).toBe("3 x 10 squat");
    expect(normalizeName("Ｂench")).toBe("bench");
  });

  it("looseKey folds plurals and spellings", () => {
    expect(looseKey("Pull-Ups")).toBe(looseKey("Pull Up"));
    expect(looseKey("Biceps Curl")).toBe(looseKey("Bicep Curl"));
    expect(looseKey("Skull Crushers")).toBe(looseKey("Skullcrusher"));
    expect(looseKey("Press")).toBe("press");
  });
});

describe("catalog shape", () => {
  it("has a curated set of the expected size and includes upstream entries", () => {
    expect(CURATED_EXERCISES.length).toBeGreaterThanOrEqual(120);
    expect(CURATED_EXERCISES.length).toBeLessThanOrEqual(200);
    expect(EXERCISES.length).toBeGreaterThan(800);
    expect(EXERCISES.some((e) => !e.curated)).toBe(true);
  });

  it("ids are unique and kebab-case; curated ids derive from the name", () => {
    const ids = EXERCISES.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(KEBAB);
    expect(getExercise("overhead-press-barbell")?.name).toBe("Overhead Press (Barbell)");
    expect(getExercise("triceps-pushdown-cable-straight-bar")?.name).toBe("Triceps Pushdown (Cable - Straight Bar)");
  });

  it("curated names are unique after normalization", () => {
    const keys = CURATED_EXERCISES.map((e) => looseKey(e.name));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("aliases are unique across the catalog and never collide with a curated name", () => {
    const names = new Set(CURATED_EXERCISES.map((e) => looseKey(e.name)));
    const seen = new Map<string, string>();
    const dupes: string[] = [];
    for (const e of CURATED_EXERCISES) {
      for (const a of e.aliases) {
        const k = looseKey(a);
        if (seen.has(k) || names.has(k)) dupes.push(`${a} (${e.name} vs ${seen.get(k) ?? "a name"})`);
        seen.set(k, e.name);
      }
    }
    expect(dupes).toEqual([]);
  });

  it("a curated alias wins over an upstream entry that shares its name", () => {
    const upstream = new Set(EXERCISES.filter((e) => !e.curated).map((e) => looseKey(e.name)));
    const shadowing = CURATED_EXERCISES.flatMap((e) =>
      e.aliases.filter((a) => upstream.has(looseKey(a))).map((a) => [a, e] as const),
    );
    // "split squat" is also the name of an upstream stretch
    expect(shadowing.map(([a]) => a)).toContain("split squat");
    for (const [alias, e] of shadowing) expect(resolveExerciseName(alias)?.id).toBe(e.id);
  });

  it("has roughly 150 aliases", () => {
    const total = CURATED_EXERCISES.reduce((n, e) => n + e.aliases.length, 0);
    expect(total).toBeGreaterThanOrEqual(140);
  });

  it("every exercise has a primary region and only valid regions", () => {
    const valid = new Set(MUSCLE_REGIONS);
    const bad = EXERCISES.filter(
      (e: Exercise) =>
        e.primary.length === 0 ||
        ![...e.primary, ...e.secondary].every((r) => valid.has(r)) ||
        e.secondary.some((r) => e.primary.includes(r)),
    );
    expect(bad.map((e) => e.id)).toEqual([]);
  });

  it("splits the deltoid three ways", () => {
    for (const r of ["front_delts", "side_delts", "rear_delts"] as const) {
      expect(CURATED_EXERCISES.some((e) => e.primary.includes(r))).toBe(true);
    }
    expect(getExercise("overhead-press-barbell")?.primary).toContain("front_delts");
    expect(getExercise("lateral-raise-dumbbell")?.primary).toContain("side_delts");
    expect(getExercise("face-pull-cable")?.primary).toContain("rear_delts");
    expect(getExercise("seated-row-cable")?.secondary).toContain("rear_delts");
  });

  it("curated freeDbIds exist upstream and their upstream entries are not duplicated", () => {
    const upstream = new Set(FREE_DB_ENTRIES.map((e) => e.id));
    const linked = CURATED_EXERCISES.flatMap((e) => (e.freeDbId ? [e.freeDbId] : []));
    expect(linked.filter((id) => !upstream.has(id))).toEqual([]);
    expect(new Set(linked).size).toBe(linked.length);
    const free = EXERCISES.filter((e) => !e.curated);
    expect(free.filter((e) => linked.includes(e.freeDbId ?? ""))).toEqual([]);
    expect(free.length).toBe(FREE_DB_ENTRIES.length - linked.length);
  });

  it("uses sensible tracking types", () => {
    expect(getExercise("plank")?.tracking).toBe("duration");
    expect(getExercise("pull-up")?.tracking).toBe("weighted_bodyweight");
    expect(getExercise("pull-up-assisted")?.tracking).toBe("assisted_bodyweight");
    expect(getExercise("running-treadmill")?.tracking).toBe("distance_duration");
    expect(getExercise("farmers-walk")?.tracking).toBe("weight_distance");
    expect(getExercise("bench-press-barbell")?.tracking).toBe("weight_reps");
  });
});

describe("upstream mapping", () => {
  const free = (upstreamId: string) => EXERCISES.find((e) => !e.curated && e.freeDbId === upstreamId);

  it("keeps upstream names and maps muscles and equipment", () => {
    const e = free("Barbell_Shoulder_Press");
    expect(e?.name).toBe("Barbell Shoulder Press");
    expect(e?.equipment).toBe("barbell");
    expect(e?.primary).toEqual(["front_delts"]);
    expect(free("Cable_Rope_Rear-Delt_Rows")?.primary).toEqual(["rear_delts"]);
    expect(free("One-Arm_Side_Laterals")?.primary).toEqual(["side_delts"]);
    expect(free("Smith_Machine_Leg_Press")?.equipment).toBe("smith");
    expect(free("EZ-Bar_Curl")).toBeUndefined();
    expect(free("Middle_Back_Shrug")?.primary).toEqual(["upper_back"]);
    expect(free("Clean")?.category).toBe("olympic");
  });
});

describe("resolveExerciseName", () => {
  it("resolves every share-text name", () => {
    const missing = SHARE_NAMES.filter((n) => resolveExerciseName(n)?.name !== n);
    expect(missing).toEqual([]);
  });

  it("resolves an aliased base with another variant's equipment suffix", () => {
    expect(resolveExerciseName("Shoulder Press (Dumbbell)")?.id).toBe("overhead-press-dumbbell");
    expect(resolveExerciseName("Military Press (Smith Machine)")?.id).toBe("overhead-press-smith-machine");
    expect(resolveExerciseName("Shoulder Press (Machine)")?.id).toBe("shoulder-press-machine");
    expect(resolveExerciseName("Totally Unknown (Dumbbell)")).toBeUndefined();
  });

  it("resolves aliases and spelling variants", () => {
    expect(resolveExerciseName("OHP")?.id).toBe("overhead-press-barbell");
    expect(resolveExerciseName("military press")?.id).toBe("overhead-press-barbell");
    expect(resolveExerciseName("Pull-Up")?.id).toBe("pull-up");
    expect(resolveExerciseName("pullups")?.id).toBe("pull-up");
    expect(resolveExerciseName("Chin-Ups")?.id).toBe("chin-up");
    expect(resolveExerciseName("Biceps Curl (Dumbbell)")?.id).toBe("bicep-curl-dumbbell");
    expect(resolveExerciseName("Farmers Walk")?.id).toBe("farmers-walk");
    expect(resolveExerciseName("bench press barbell")?.id).toBe("bench-press-barbell");
    expect(resolveExerciseName("RDL")?.id).toBe("romanian-deadlift-barbell");
  });

  it("tolerates share-text dash suffixes in both directions", () => {
    expect(resolveExerciseName("Triceps Pushdown (Cable)")?.id).toBe("triceps-pushdown-cable-straight-bar");
    expect(resolveExerciseName("Lat Pulldown (Cable - Wide Grip)")?.id).toBe("lat-pulldown-cable");
  });

  it("returns undefined for unknown names", () => {
    expect(resolveExerciseName("Underwater Basket Weaving")).toBeUndefined();
    expect(resolveExerciseName("")).toBeUndefined();
  });

  it("works on a custom catalog", () => {
    const custom: Exercise = {
      id: "zercher-carry",
      name: "Zercher Carry",
      equipment: "barbell",
      category: "strongman",
      tracking: "weight_distance",
      primary: ["upper_back"],
      secondary: [],
      aliases: ["zercher walk"],
      curated: false,
    };
    expect(resolveExerciseName("Zercher Walk", [custom])?.id).toBe("zercher-carry");
    expect(resolveExerciseName("Bench Press (Barbell)", [custom])).toBeUndefined();
    expect(getExercise("zercher-carry", [custom])).toBe(custom);
  });
});
