import { describe, expect, it } from "vitest";
import {
  byPositionThenName,
  emptyPlannedSet,
  groupTemplates,
  moveItem,
  normalizeSupersets,
  parsePlannedSets,
  planTemplateSave,
  plannedFields,
  plannedFromLogged,
  positionUpdates,
  serializePlannedSets,
  setsFromPlanned,
  toggleSupersetWithPrevious,
  type PlannedSet,
} from "../templates";

const p = (weight: number | null, reps: number | null, kind: PlannedSet["kind"] = "normal"): PlannedSet => ({
  kind,
  weight,
  unit: "lb",
  reps,
  durationS: null,
  distanceM: null,
});

describe("planned sets", () => {
  it("parses tolerantly", () => {
    expect(parsePlannedSets(null)).toEqual([]);
    expect(parsePlannedSets("not json")).toEqual([]);
    expect(parsePlannedSets('{"a":1}')).toEqual([]);
    expect(parsePlannedSets('[{"kind":"warmup","weight":95,"unit":"kg","reps":5}, 3, {"kind":"bogus","reps":"x"}]')).toEqual([
      { kind: "warmup", weight: 95, unit: "kg", reps: 5, durationS: null, distanceM: null },
      { kind: "normal", weight: null, unit: "lb", reps: null, durationS: null, distanceM: null },
    ]);
  });

  it("serializes with a stable key order", () => {
    const a = serializePlannedSets([{ reps: 5, kind: "normal", unit: "lb", weight: 135, distanceM: null, durationS: null } as PlannedSet]);
    expect(a).toBe('[{"kind":"normal","weight":135,"unit":"lb","reps":5,"durationS":null,"distanceM":null}]');
    expect(serializePlannedSets(parsePlannedSets(a))).toBe(a);
  });

  it("prefills workout sets from a plan, with no rpe", () => {
    expect(setsFromPlanned([p(135, 5, "warmup"), p(225, 5)], "kg")).toEqual([
      { kind: "warmup", weight: 135, unit: "lb", reps: 5, durationS: null, distanceM: null, rpe: null },
      { kind: "normal", weight: 225, unit: "lb", reps: 5, durationS: null, distanceM: null, rpe: null },
    ]);
  });

  it("gives an unplanned exercise one empty set", () => {
    expect(setsFromPlanned([], "kg")).toEqual([
      { kind: "normal", weight: null, unit: "kg", reps: null, durationS: null, distanceM: null, rpe: null },
    ]);
  });

  it("builds a plan from logged sets", () => {
    const logged = [
      { position: 1, kind: "normal" as const, weight: 225, unit: "lb" as const, reps: 5, durationS: null, distanceM: null, completed: 0 },
      { position: 0, kind: "warmup" as const, weight: 135, unit: "lb" as const, reps: 8, durationS: null, distanceM: null, completed: 1 },
    ];
    expect(plannedFromLogged(logged, true)).toEqual([p(135, 8, "warmup")]);
    expect(plannedFromLogged(logged, false)).toEqual([p(135, 8, "warmup"), p(225, 5)]);
  });

  it("copies the previous planned set, keeping only warmup kind", () => {
    expect(emptyPlannedSet("kg")).toEqual({ kind: "normal", weight: null, unit: "kg", reps: null, durationS: null, distanceM: null });
    expect(emptyPlannedSet("kg", p(100, 3, "drop"))).toEqual(p(100, 3));
    expect(emptyPlannedSet("kg", p(45, 10, "warmup"))).toEqual(p(45, 10, "warmup"));
  });

  it("maps tracking types to fields", () => {
    expect(plannedFields("weight_reps")).toEqual(["weight", "reps"]);
    expect(plannedFields("reps")).toEqual(["reps"]);
    expect(plannedFields("duration")).toEqual(["durationS"]);
    expect(plannedFields("distance_duration")).toEqual(["distanceM", "durationS"]);
    expect(plannedFields("weight_distance")).toEqual(["weight", "distanceM"]);
    expect(plannedFields("assisted_bodyweight")).toEqual(["weight", "reps"]);
  });
});

describe("supersets", () => {
  it("renumbers by first appearance and drops singletons", () => {
    expect(normalizeSupersets([7, 7, null, 3, 9, 3])).toEqual([1, 1, null, 2, null, 2]);
  });

  it("links and unlinks with the item above", () => {
    expect(toggleSupersetWithPrevious([null, null, null], 1)).toEqual([1, 1, null]);
    expect(toggleSupersetWithPrevious([1, 1, null], 2)).toEqual([1, 1, 1]);
    expect(toggleSupersetWithPrevious([1, 1, 1], 1)).toEqual([null, 1, 1]);
    expect(toggleSupersetWithPrevious([1, 1, 1], 2)).toEqual([1, 1, null]);
    // joining a pair onto the item above moves the whole pair
    expect(toggleSupersetWithPrevious([null, 2, 2], 1)).toEqual([1, 1, 1]);
    expect(toggleSupersetWithPrevious([null, null], 0)).toEqual([null, null]);
  });
});

describe("planTemplateSave", () => {
  const plan = serializePlannedSets([p(100, 5)]);
  const existing = [
    { id: "a", exerciseId: "squat", position: 0, supersetGroup: null, restS: 120, plannedSets: plan, notes: null },
    { id: "b", exerciseId: "bench", position: 1, supersetGroup: null, restS: null, plannedSets: plan, notes: null },
    { id: "c", exerciseId: "row", position: 2, supersetGroup: null, restS: null, plannedSets: plan, notes: null },
  ];

  it("is empty when nothing changed", () => {
    const draft = existing.map((e) => ({ ...e, plannedSets: parsePlannedSets(e.plannedSets) }));
    expect(planTemplateSave(existing, draft)).toEqual({ inserts: [], updates: [], deletes: [] });
  });

  it("diffs inserts, updates (incl. reorder) and deletes", () => {
    const out = planTemplateSave(existing, [
      { id: "c", exerciseId: "row", supersetGroup: null, restS: null, notes: "  ", plannedSets: [p(100, 5)] },
      { id: "a", exerciseId: "squat", supersetGroup: null, restS: 90, notes: null, plannedSets: [p(100, 5)] },
      { exerciseId: "curl", supersetGroup: null, restS: null, notes: "slow", plannedSets: [] },
    ]);
    expect(out.deletes).toEqual(["b"]);
    expect(out.updates).toEqual([
      { id: "c", exerciseId: "row", position: 0, supersetGroup: null, restS: null, plannedSets: plan, notes: null },
      { id: "a", exerciseId: "squat", position: 1, supersetGroup: null, restS: 90, plannedSets: plan, notes: null },
    ]);
    expect(out.inserts).toEqual([
      { exerciseId: "curl", position: 2, supersetGroup: null, restS: null, plannedSets: "[]", notes: "slow" },
    ]);
  });

  it("treats a repeated draft id as a new row", () => {
    const draft = [
      { id: "a", exerciseId: "squat", supersetGroup: null, restS: 120, notes: null, plannedSets: [p(100, 5)] },
      { id: "a", exerciseId: "squat", supersetGroup: null, restS: 120, notes: null, plannedSets: [p(100, 5)] },
    ];
    const out = planTemplateSave(existing, draft);
    expect(out.inserts).toHaveLength(1);
    expect(out.deletes).toEqual(["b", "c"]);
  });

  it("normalizes superset groups on save", () => {
    const out = planTemplateSave(
      [],
      [
        { exerciseId: "x", supersetGroup: 5, restS: null, notes: null, plannedSets: [] },
        { exerciseId: "y", supersetGroup: 5, restS: null, notes: null, plannedSets: [] },
        { exerciseId: "z", supersetGroup: 8, restS: null, notes: null, plannedSets: [] },
      ]
    );
    expect(out.inserts.map((i) => i.supersetGroup)).toEqual([1, 1, null]);
  });
});

describe("ordering", () => {
  const items = [
    { id: "1", position: 2, name: "b" },
    { id: "2", position: 0, name: "z" },
    { id: "3", position: 2, name: "a" },
  ];

  it("sorts by position then name", () => {
    expect([...items].sort(byPositionThenName).map((i) => i.id)).toEqual(["2", "3", "1"]);
  });

  it("moves items with clamping", () => {
    expect(moveItem(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveItem(["a", "b", "c"], 2, -5)).toEqual(["c", "a", "b"]);
    expect(moveItem(["a", "b"], 5, 0)).toEqual(["a", "b"]);
  });

  it("only rewrites positions that changed", () => {
    expect(
      positionUpdates([
        { id: "x", position: 0 },
        { id: "y", position: 5 },
        { id: "z", position: 1 },
      ])
    ).toEqual([
      { id: "y", position: 1 },
      { id: "z", position: 2 },
    ]);
  });

  it("groups templates under folders, unfiled last", () => {
    const folders = [
      { id: "f2", position: 1, name: "pull" },
      { id: "f1", position: 0, name: "push" },
    ];
    const templates = [
      { id: "t1", position: 1, name: "bench", folderId: "f1" },
      { id: "t2", position: 0, name: "ohp", folderId: "f1" },
      { id: "t3", position: 0, name: "loose", folderId: null },
      { id: "t4", position: 0, name: "orphan", folderId: "gone" },
    ];
    const sections = groupTemplates(folders, templates);
    expect(sections.map((s) => [s.folder?.id ?? null, s.templates.map((t) => t.id)])).toEqual([
      ["f1", ["t2", "t1"]],
      ["f2", []],
      [null, ["t3", "t4"]],
    ]);
    expect(groupTemplates([], [])).toEqual([{ folder: null, templates: [] }]);
  });
});
