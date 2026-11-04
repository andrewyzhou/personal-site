import { describe, expect, it } from "vitest";
import { searchExercises } from "../search";
import { EXERCISES, getExercise } from "../catalog";
import type { Exercise } from "../types";

const names = (q: string, opts?: Parameters<typeof searchExercises>[1]) =>
  searchExercises(q, opts).map((r) => r.exercise.name);

describe("searchExercises", () => {
  it("exact name match comes first with the exact tier", () => {
    const [top] = searchExercises("Bench Press (Barbell)");
    expect(top.exercise.id).toBe("bench-press-barbell");
    expect(top.tier).toBe("exact");
  });

  it("'shoulder press' and 'ohp' rank overhead press first", () => {
    expect(names("shoulder press")[0]).toMatch(/^Overhead Press/);
    expect(names("ohp")[0]).toMatch(/^Overhead Press/);
    expect(searchExercises("ohp")[0].tier).toBe("alias");
  });

  it("'bench' -> barbell bench press first, other bench variants follow", () => {
    const r = names("bench");
    expect(r[0]).toBe("Bench Press (Barbell)");
    expect(r.slice(0, 6)).toContain("Bench Press (Dumbbell)");
  });

  it("'rdl' -> romanian deadlift", () => {
    expect(names("rdl")[0]).toBe("Romanian Deadlift (Barbell)");
    expect(names("rdl").slice(0, 3)).toContain("Romanian Deadlift (Dumbbell)");
  });

  it("'lat raise' and 'lateral' -> lateral raise first", () => {
    expect(names("lat raise")[0]).toMatch(/^Lateral Raise/);
    expect(names("lateral")[0]).toMatch(/^Lateral Raise/);
    expect(names("lateral raise")[0]).toBe("Lateral Raise (Dumbbell)");
  });

  it("prefix matches partial typing", () => {
    expect(names("inc bench")[0]).toMatch(/^Incline Bench Press/);
    expect(names("bench pr")[0]).toMatch(/^Bench Press/);
    expect(searchExercises("hammer cu")[0].tier).toBe("prefix");
    expect(names("db bench")[0]).toBe("Bench Press (Dumbbell)");
  });

  it("tolerates typos", () => {
    const r = searchExercises("benhc pres");
    expect(r.length).toBeGreaterThan(0);
    expect(r[0].exercise.name).toMatch(/^Bench Press/);
    expect(r[0].tier).toBe("fuzzy");
    expect(names("latteral raise")[0]).toMatch(/^Lateral Raise/);
    expect(names("skul crusher")[0]).toMatch(/^Skullcrusher/);
  });

  it("falls back to muscles", () => {
    const side = searchExercises("side delts");
    expect(side.slice(0, 5).some((r) => r.exercise.name.startsWith("Lateral Raise"))).toBe(true);
    expect(side.some((r) => r.tier === "muscle")).toBe(true);
    for (const r of side.filter((x) => x.tier === "muscle").slice(0, 5)) {
      expect(r.exercise.primary).toContain("side_delts");
    }

    const abs = searchExercises("abs");
    expect(abs[0].exercise.primary).toContain("abs");

    const quads = searchExercises("quads", { limit: 200 });
    const muscle = quads.filter((r) => r.tier === "muscle");
    expect(muscle.length).toBeGreaterThan(0);
    // primary-region matches come before secondary ones
    const firstSecondary = muscle.findIndex((r) => !r.exercise.primary.includes("quads"));
    if (firstSecondary >= 0) {
      expect(muscle.slice(firstSecondary).every((r) => !r.exercise.primary.includes("quads"))).toBe(true);
    }

    const shoulders = names("shoulders");
    expect(shoulders.length).toBeGreaterThan(5);
    expect(names("legs").length).toBeGreaterThan(5);
    expect(names("back").length).toBeGreaterThan(5);
  });

  it("usage reorders within a tier", () => {
    const usage = { "overhead-press-dumbbell": 40 };
    const r = names("shoulder press", { usage });
    expect(r[0]).toBe("Overhead Press (Dumbbell)");
    expect(r.indexOf("Overhead Press (Dumbbell)")).toBeLessThan(r.indexOf("Overhead Press (Barbell)"));
    expect(names("shoulder press")[0]).toBe("Overhead Press (Barbell)");
  });

  it("a curated alias outranks an upstream entry with the same name", () => {
    const [top, second] = searchExercises("split squat");
    expect(top.exercise.id).toBe("split-squat-dumbbell");
    expect(second.exercise.curated).toBe(false);
    expect(second.tier).toBe("alias");
  });

  it("usage never lifts a weaker tier over a stronger one", () => {
    // the exact match beats a prefix match with enormous usage
    const usage = { "lateral-raise-dumbbell": 1e9 };
    const r = searchExercises("lateral raise (cable)", { usage });
    expect(r[0].exercise.id).toBe("lateral-raise-cable");
    const tiers = ["exact", "alias", "prefix", "fuzzy", "muscle"];
    const heavy = Object.fromEntries(EXERCISES.map((e, i) => [e.id, i]));
    const ranked = searchExercises("curl", { usage: heavy, limit: 500 });
    for (let i = 1; i < ranked.length; i++) {
      expect(tiers.indexOf(ranked[i].tier)).toBeGreaterThanOrEqual(tiers.indexOf(ranked[i - 1].tier));
    }
  });

  it("curated entries win ties over upstream entries", () => {
    const r = searchExercises("lateral");
    const firstUpstream = r.findIndex((x) => !x.exercise.curated);
    const lastCuratedSameScore = r.findLastIndex((x) => x.exercise.curated && x.score === r[firstUpstream].score);
    expect(lastCuratedSameScore).toBeLessThan(firstUpstream);
  });

  it("empty query browses everything: usage, then curated, then name", () => {
    const usage = { "plank": 3, "squat-barbell": 10 };
    const r = searchExercises("", { usage, limit: 2000 });
    expect(r.length).toBe(EXERCISES.length);
    expect(r[0].exercise.id).toBe("squat-barbell");
    expect(r[1].exercise.id).toBe("plank");
    const curatedRest = r.slice(2).filter((x) => x.exercise.curated).map((x) => x.exercise.name.toLowerCase());
    expect(r.slice(2, 2 + curatedRest.length).every((x) => x.exercise.curated)).toBe(true);
    expect(searchExercises("   ").length).toBe(50);
  });

  it("respects limit and returns nothing for gibberish", () => {
    expect(searchExercises("press", { limit: 5 })).toHaveLength(5);
    expect(searchExercises("press", { limit: 0 })).toHaveLength(0);
    expect(searchExercises("qqqqzzzz")).toEqual([]);
  });

  it("searches a custom catalog", () => {
    const custom: Exercise = {
      id: "custom-zercher-squat",
      name: "Zercher Squat (Barbell)",
      equipment: "barbell",
      category: "strength",
      tracking: "weight_reps",
      primary: ["quads"],
      secondary: ["upper_back"],
      aliases: ["zercher"],
      curated: false,
    };
    const catalog = [...EXERCISES.slice(0, 10), custom];
    const r = searchExercises("zercher", { catalog });
    expect(r[0].exercise).toBe(custom);
    expect(r[0].tier).toBe("alias");
    expect(r.every((x) => catalog.includes(x.exercise))).toBe(true);
    expect(searchExercises("zercher squat", { catalog: [custom] })[0].tier).toBe("alias");
    expect(getExercise(custom.id)).toBeUndefined();
  });

  it("is fast enough for keystroke search", () => {
    const queries = ["b", "be", "ben", "benc", "bench", "bench p", "latteral", "side delts", "squat bar", "xyz"];
    searchExercises("warm");
    const start = performance.now();
    for (let i = 0; i < 10; i++) for (const q of queries) searchExercises(q);
    const perQuery = (performance.now() - start) / (10 * queries.length);
    expect(perQuery).toBeLessThan(10);
  });
});
