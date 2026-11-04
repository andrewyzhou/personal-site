import { describe, expect, it } from "vitest";
import { EXERCISES, type Exercise } from "lift-core";
import {
  convertWeight,
  formatWeight,
  parseBodyweight,
  parseDateInput,
  parseUnit,
  toDateInput,
  trendPoints,
} from "../bodyweight";
import {
  buildExerciseLookup,
  catalogCollision,
  equipmentInUse,
  filterKey,
  isSearchable,
  matchesFilter,
  searchCatalog,
  toggleRegion,
  type CustomRowLike,
} from "../library";
import { mergeLinkMap, planMerge, resolveMergedId } from "../merge";
import { cleanName, copyName, validateName } from "../names";

function custom(id: string, name: string, extra: Partial<CustomRowLike> = {}): CustomRowLike {
  return {
    id,
    name,
    equipment: "dumbbell",
    tracking: "weight_reps",
    primary: '["chest"]',
    secondary: "[]",
    archived: 0,
    mergedInto: null,
    ...extra,
  };
}

const bench = EXERCISES.find((e) => e.id === "bench-press-barbell") ?? EXERCISES[0]!;

describe("names", () => {
  it("cleans whitespace", () => {
    expect(cleanName("  push   day \n")).toBe("push day");
  });
  it("validates required, length and duplicates", () => {
    expect(validateName("   ")).toEqual({ ok: false, error: "name is required" });
    expect(validateName("x".repeat(81))).toEqual({ ok: false, error: "name is too long" });
    expect(validateName("Push Day", { taken: ["push  day"] })).toEqual({ ok: false, error: "that name is taken" });
    expect(validateName(" legs ", { taken: ["push"] })).toEqual({ ok: true, name: "legs" });
  });
  it("picks a free copy name", () => {
    expect(copyName("push", ["push"])).toBe("push copy");
    expect(copyName("push", ["push", "Push Copy", "push copy 2"])).toBe("push copy 3");
  });
});

describe("merge", () => {
  const links = mergeLinkMap([
    { id: "custom-a", mergedInto: "custom-b" },
    { id: "custom-b", mergedInto: "bench-press-barbell" },
    { id: "custom-c", mergedInto: null },
    { id: "custom-x", mergedInto: "custom-y" },
    { id: "custom-y", mergedInto: "custom-x" },
  ]);

  it("follows chains and stops on cycles", () => {
    expect(resolveMergedId("custom-a", links)).toBe("bench-press-barbell");
    expect(resolveMergedId("custom-c", links)).toBe("custom-c");
    expect(resolveMergedId("squat", links)).toBe("squat");
    expect(resolveMergedId("custom-x", links)).toBe("custom-y");
  });

  it("plans re-pointing of only the source's rows", () => {
    const check = planMerge(
      "custom-c",
      "custom-a",
      links,
      [
        { id: "we1", exerciseId: "custom-c" },
        { id: "we2", exerciseId: "squat" },
      ],
      [{ id: "te1", exerciseId: "custom-c" }]
    );
    expect(check).toEqual({
      ok: true,
      plan: { targetId: "bench-press-barbell", workoutExercises: ["we1"], templateExercises: ["te1"] },
    });
  });

  it("refuses self, already-merged and cyclic merges", () => {
    expect(planMerge("custom-c", "custom-c", links, [], []).ok).toBe(false);
    expect(planMerge("custom-a", "custom-c", links, [], []).ok).toBe(false);
    const back = mergeLinkMap([
      { id: "custom-p", mergedInto: null },
      { id: "custom-q", mergedInto: "custom-p" },
    ]);
    expect(planMerge("custom-p", "custom-q", back, [], [])).toEqual({ ok: false, error: "that exercise was merged into this one" });
  });
});

describe("library catalog", () => {
  const rows = [
    custom("custom-live", "landmine press"),
    custom("custom-old", "old curl", { archived: 1 }),
    custom("custom-merged", "bench dupe", { archived: 1, mergedInto: bench.id }),
  ];

  it("hides archived and merged customs from search", () => {
    expect(isSearchable(rows[0]!)).toBe(true);
    expect(isSearchable(rows[1]!)).toBe(false);
    const ids = searchCatalog([bench], rows).map((e) => e.id);
    expect(ids).toEqual([bench.id, "custom-live"]);
    expect(searchCatalog([bench], rows, true).map((e) => e.id)).toEqual([bench.id, "custom-live", "custom-old"]);
  });

  it("looks up archived customs and resolves merged ids", () => {
    const lookup = buildExerciseLookup([bench], rows);
    expect(lookup("custom-old")?.name).toBe("old curl");
    expect(lookup("custom-merged")?.id).toBe(bench.id);
    expect(lookup("nope")).toBeUndefined();
  });

  it("filters by custom, region and equipment", () => {
    const e: Exercise = { ...bench, id: "custom-z", equipment: "cable", primary: ["lats"] };
    expect(matchesFilter(e, { kind: "all" })).toBe(true);
    expect(matchesFilter(e, { kind: "custom" })).toBe(true);
    expect(matchesFilter(bench, { kind: "custom" })).toBe(false);
    expect(matchesFilter(e, { kind: "region", region: "lats" })).toBe(true);
    expect(matchesFilter(e, { kind: "region", region: "chest" })).toBe(false);
    expect(matchesFilter(e, { kind: "equipment", equipment: "cable" })).toBe(true);
    expect(filterKey({ kind: "region", region: "lats" })).toBe("region:lats");
  });

  it("lists equipment by frequency", () => {
    const list = [
      { ...bench, equipment: "cable" as const },
      { ...bench, equipment: "barbell" as const },
      { ...bench, equipment: "cable" as const },
    ];
    expect(equipmentInUse(list)).toEqual(["cable", "barbell"]);
  });

  it("keeps a region in only one list", () => {
    expect(toggleRegion(["chest"], ["triceps"], "triceps")).toEqual({ list: ["chest", "triceps"], other: [] });
    expect(toggleRegion(["chest"], [], "chest")).toEqual({ list: [], other: [] });
  });

  it("flags names that resolve to a catalog exercise", () => {
    expect(catalogCollision(bench.name)?.id).toBe(bench.id);
    expect(catalogCollision("zzz quux machine thing")).toBeUndefined();
    expect(catalogCollision("  ")).toBeUndefined();
  });
});

describe("bodyweight", () => {
  it("converts and parses", () => {
    expect(convertWeight(100, "kg", "lb")).toBeCloseTo(220.46, 2);
    expect(convertWeight(220.462262185, "lb", "kg")).toBeCloseTo(100, 6);
    expect(convertWeight(5, "lb", "lb")).toBe(5);
    expect(parseUnit("kg")).toBe("kg");
    expect(parseUnit(undefined)).toBe("lb");
    expect(parseUnit("stone")).toBe("lb");
    expect(parseBodyweight("182,4")).toBe(182.4);
    expect(parseBodyweight("")).toBeNull();
    expect(parseBodyweight("0")).toBeNull();
    expect(parseBodyweight("-3")).toBeNull();
    expect(parseBodyweight("abc")).toBeNull();
    expect(formatWeight(182.449)).toBe("182.4");
  });

  it("round-trips local dates and rejects the future", () => {
    const now = new Date(2026, 10, 4, 9, 30).getTime();
    expect(toDateInput(now)).toBe("2026-11-04");
    expect(parseDateInput("2026-11-04", now)).toBe(now);
    const earlier = parseDateInput("2026-11-01", now)!;
    expect(new Date(earlier).getDate()).toBe(1);
    expect(new Date(earlier).getHours()).toBe(9);
    expect(parseDateInput("2026-11-05", now)).toBeNull();
    expect(parseDateInput("2026-02-30", now)).toBeNull();
    expect(parseDateInput("nov 4", now)).toBeNull();
  });

  it("builds trend points by time with min at the bottom", () => {
    expect(trendPoints([{ measuredAt: 0, weight: 180, unit: "lb" }], "lb", 100, 50)).toBe("");
    const pts = trendPoints(
      [
        { measuredAt: 2000, weight: 190, unit: "lb" },
        { measuredAt: 0, weight: 180, unit: "lb" },
        { measuredAt: 1000, weight: 185, unit: "lb" },
      ],
      "lb",
      100,
      50,
      0
    );
    expect(pts).toBe("0,50 50,25 100,0");
    expect(
      trendPoints(
        [
          { measuredAt: 0, weight: 80, unit: "kg" },
          { measuredAt: 10, weight: 80, unit: "kg" },
        ],
        "lb",
        10,
        10,
        0
      )
    ).toBe("0,5 10,5");
  });
});
