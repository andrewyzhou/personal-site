import { describe, expect, it, vi } from "vitest";
import { actionAt, compactActions, sheetOptions, type MenuAction } from "../actionMenu";
import { describeCustomUsage, isCustomInUse } from "../custom";
import {
  MAX_NOTE_LENGTH,
  MAX_TITLE_LENGTH,
  NUMERIC_LIMITS,
  clampNumber,
  clampSetNumbers,
  clampTitle,
  cleanNote,
} from "../numbers";
import { choosePrefill } from "../sets";
import { parsePlannedSets, planTemplateSave, serializePlannedSets, setsFromPlanned, type PlannedSet } from "../templates";

const act = (label: string, destructive = false): MenuAction => ({ label, onPress: vi.fn(), destructive });

describe("action menu", () => {
  it("puts cancel last and flags destructive indices", () => {
    const actions = [act("start"), act("edit"), act("duplicate"), act("move up"), act("delete", true)];
    expect(sheetOptions(actions)).toEqual({
      options: ["start", "edit", "duplicate", "move up", "delete", "cancel"],
      cancelButtonIndex: 5,
      destructiveButtonIndex: [4],
    });
  });

  it("maps a button index back to its action; cancel is nothing", () => {
    const actions = [act("a"), act("b")];
    expect(actionAt(actions, 1)).toBe(actions[1]);
    expect(actionAt(actions, 2)).toBeUndefined();
    expect(actionAt(actions, -1)).toBeUndefined();
  });

  it("keeps every action past three (the android alert limit)", () => {
    const list = compactActions([act("1"), false, act("2"), null, act("3"), undefined, act("4"), act("5")]);
    expect(list.map((a) => a.label)).toEqual(["1", "2", "3", "4", "5"]);
  });
});

describe("choosePrefill", () => {
  const session = [{ w: 135 }, { w: 185 }, { w: 225 }];
  it("copies last session's set at the same position (pyramid)", () => {
    expect(choosePrefill(session, 1, { w: 135 }, () => undefined)).toEqual({ w: 185 });
    expect(choosePrefill(session, 2, { w: 185 }, () => undefined)).toEqual({ w: 225 });
  });
  it("falls back to this workout's last set past the session's length", () => {
    expect(choosePrefill(session, 3, { w: 225 }, () => undefined)).toEqual({ w: 225 });
  });
  it("then to an earlier entry in this workout, then nothing", () => {
    const sibling = vi.fn(() => ({ w: 95 }));
    expect(choosePrefill([], 0, undefined, sibling)).toEqual({ w: 95 });
    expect(choosePrefill([], 0, undefined, () => undefined)).toBeUndefined();
  });
  it("only queries the sibling when needed", () => {
    const sibling = vi.fn(() => ({ w: 95 }));
    choosePrefill(session, 0, undefined, sibling);
    expect(sibling).not.toHaveBeenCalled();
  });
});

describe("setsFromPlanned with last session", () => {
  const planned = (weight: number | null, reps: number | null, unit: "lb" | "kg" = "lb"): PlannedSet => ({
    kind: "normal",
    weight,
    unit,
    reps,
    durationS: null,
    distanceM: null,
  });
  const prev = (weight: number | null, reps: number | null, unit: "lb" | "kg" = "kg") => ({
    weight,
    unit,
    reps,
    durationS: null,
    distanceM: null,
  });

  it("fills only the blank fields, position by position", () => {
    const out = setsFromPlanned([planned(null, 5), planned(100, null), planned(null, null)], "lb", [prev(60, 8), prev(70, 6)]);
    expect(out.map((s) => [s.weight, s.unit, s.reps])).toEqual([
      [60, "kg", 5],
      [100, "lb", 6],
      // past the session's length: its last set
      [70, "kg", 6],
    ]);
  });

  it("keeps a fully planned set untouched", () => {
    expect(setsFromPlanned([planned(100, 5)], "lb", [prev(60, 8)])[0]).toMatchObject({ weight: 100, unit: "lb", reps: 5 });
  });

  it("an unplanned exercise starts from last session's first set", () => {
    expect(setsFromPlanned([], "lb", [prev(60, 8)])).toEqual([
      { kind: "normal", weight: 60, unit: "kg", reps: 8, durationS: null, distanceM: null, rpe: null },
    ]);
  });

  it("no history: behaves as before", () => {
    expect(setsFromPlanned([planned(null, null)], "kg")[0]).toMatchObject({ weight: null, reps: null, unit: "lb" });
  });
});

describe("server bounds", () => {
  // mirrors src/lib/lift/sync/validate.ts
  it("matches the validator ranges", () => {
    expect(NUMERIC_LIMITS).toEqual({
      weight: { min: -100_000, max: 100_000, integer: false },
      reps: { min: 0, max: 100_000, integer: true },
      durationS: { min: 0, max: 10_000_000, integer: true },
      distanceM: { min: 0, max: 10_000_000, integer: false },
      rpe: { min: 0, max: 10, integer: false },
      bodyweight: { min: 0.001, max: 100_000, integer: false },
    });
    expect(MAX_TITLE_LENGTH).toBe(500);
    expect(MAX_NOTE_LENGTH).toBe(10_000);
  });

  it("clamps typos into range and keeps null", () => {
    expect(clampNumber(2_250_000, "weight")).toBe(100_000);
    expect(clampNumber(-500_000, "weight")).toBe(-100_000);
    expect(clampNumber(-40, "weight")).toBe(-40);
    expect(clampNumber(5_000_000, "reps")).toBe(100_000);
    expect(clampNumber(8.6, "reps")).toBe(9);
    expect(clampNumber(99_999_999, "durationS")).toBe(10_000_000);
    expect(clampNumber(-1, "distanceM")).toBe(0);
    expect(clampNumber(11, "rpe")).toBe(10);
    expect(clampNumber(0, "bodyweight")).toBe(0.001);
    expect(clampNumber(null, "weight")).toBeNull();
    expect(clampNumber(Number.NaN, "weight")).toBeNull();
  });

  it("clamps only the set fields present in a patch", () => {
    expect(clampSetNumbers({ weight: 1e9 })).toEqual({ weight: 100_000 });
    expect(clampSetNumbers({ reps: 1e9, note: "x" })).toEqual({ reps: 100_000, note: "x" });
    expect(clampSetNumbers({ rpe: null })).toEqual({ rpe: null });
  });

  it("cuts notes and titles to length", () => {
    expect(cleanNote("  ")).toBeNull();
    expect(cleanNote(" hi ")).toBe("hi");
    expect(cleanNote("x".repeat(20_000))!.length).toBe(MAX_NOTE_LENGTH);
    expect(clampTitle("t".repeat(600)).length).toBe(MAX_TITLE_LENGTH);
  });

  it("serialized plans are clamped", () => {
    const plan = serializePlannedSets([{ kind: "normal", weight: 9e9, unit: "lb", reps: 9e9, durationS: null, distanceM: -5 }]);
    expect(parsePlannedSets(plan)[0]).toMatchObject({ weight: 100_000, reps: 100_000, distanceM: 0 });
  });

  it("template saves clamp rest and notes", () => {
    const plan = planTemplateSave(
      [],
      [{ exerciseId: "bench", supersetGroup: null, restS: 99_999, notes: "n".repeat(12_000), plannedSets: [] }]
    );
    expect(plan.inserts[0]!.restS).toBe(30 * 60);
    expect(plan.inserts[0]!.notes!.length).toBe(MAX_NOTE_LENGTH);
  });
});

describe("custom exercise usage", () => {
  it("a custom that others were merged into is in use", () => {
    const u = { workoutExercises: 0, templateExercises: 0, mergedFrom: 1 };
    expect(isCustomInUse(u)).toBe(true);
    expect(describeCustomUsage(u)).toBe("1 merged exercise");
  });
  it("unused is deletable", () => {
    expect(isCustomInUse({ workoutExercises: 0, templateExercises: 0, mergedFrom: 0 })).toBe(false);
  });
  it("lists every reason", () => {
    expect(describeCustomUsage({ workoutExercises: 3, templateExercises: 1, mergedFrom: 2 })).toBe(
      "3 workout entries and 1 template entry and 2 merged exercises"
    );
  });
});
