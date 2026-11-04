import { describe, expect, it } from "vitest";
import { countUncompleted, planFinish } from "../finish";
import {
  RPE_VALUES,
  diffExercises,
  formatPrevious,
  formatRpe,
  groupEdges,
  isRpe,
  linkWithNext,
  moveExercise,
  normalizeGroups,
  parseUnit,
  pickPrevious,
  prefillSet,
  unlinkFromNext,
  type OrderedExercise,
} from "../sets";

const list = (...groups: (number | null)[]): OrderedExercise[] =>
  groups.map((g, i) => ({ id: String.fromCharCode(97 + i), position: i * 10, supersetGroup: g }));
const ids = (l: OrderedExercise[]) => l.map((e) => e.id).join("");
const groups = (l: OrderedExercise[]) => l.map((e) => e.supersetGroup);

describe("normalizeGroups", () => {
  it("drops lone members and splits a reused id", () => {
    expect(groups(normalizeGroups(list(1, null, 2, 2)))).toEqual([null, null, 2, 2]);
    expect(groups(normalizeGroups(list(1, 1, null, 1, 1)))).toEqual([1, 1, null, 2, 2]);
  });
});

describe("supersets", () => {
  it("links two loose exercises with a fresh id", () => {
    expect(groups(linkWithNext(list(null, null, 3, 3), 0))).toEqual([4, 4, 3, 3]);
  });

  it("extends an existing group and merges neighbours", () => {
    expect(groups(linkWithNext(list(1, 1, null), 1))).toEqual([1, 1, 1]);
    expect(groups(linkWithNext(list(null, 2, 2), 0))).toEqual([2, 2, 2]);
    expect(groups(linkWithNext(list(1, 1, 2, 2), 1))).toEqual([1, 1, 1, 1]);
  });

  it("unlinks between two members", () => {
    expect(groups(unlinkFromNext(list(1, 1), 0))).toEqual([null, null]);
    expect(groups(unlinkFromNext(list(1, 1, 1, 1), 1))).toEqual([1, 1, 2, 2]);
    expect(groups(unlinkFromNext(list(1, 1, 1), 0))).toEqual([null, 2, 2]);
    // not linked: no-op
    expect(groups(unlinkFromNext(list(null, 1, 1), 0))).toEqual([null, 1, 1]);
  });

  it("bracket edges", () => {
    expect(groupEdges(list(null, 1, 1, 1))).toEqual([
      { grouped: false, first: false, last: false },
      { grouped: true, first: true, last: false },
      { grouped: true, first: false, last: false },
      { grouped: true, first: false, last: true },
    ]);
  });
});

describe("moveExercise", () => {
  it("swaps loose neighbours and reuses their positions", () => {
    const before = list(null, null, null);
    const after = moveExercise(before, 2, -1);
    expect(ids(after)).toBe("acb");
    expect(after.map((e) => e.position)).toEqual([0, 10, 20]);
    expect(diffExercises(before, after)).toEqual([
      { id: "c", position: 10, supersetGroup: null },
      { id: "b", position: 20, supersetGroup: null },
    ]);
  });

  it("is a no-op at the ends", () => {
    const before = list(null, null);
    expect(diffExercises(before, moveExercise(before, 0, -1))).toEqual([]);
    expect(diffExercises(before, moveExercise(before, 1, 1))).toEqual([]);
  });

  it("swaps within a superset", () => {
    const after = moveExercise(list(1, 1, null), 1, -1);
    expect(ids(after)).toBe("bac");
    expect(groups(after)).toEqual([1, 1, null]);
  });

  it("steps out of the group at its edge without moving", () => {
    const after = moveExercise(list(1, 1, 1, null), 2, 1);
    expect(ids(after)).toBe("abcd");
    expect(groups(after)).toEqual([1, 1, null, null]);
    // a pair dissolves entirely
    expect(groups(moveExercise(list(null, 1, 1), 1, -1))).toEqual([null, null, null]);
  });

  it("hops a loose exercise over a whole group", () => {
    const after = moveExercise(list(null, 1, 1, null), 0, 1);
    expect(ids(after)).toBe("bcad");
    expect(groups(after)).toEqual([1, 1, null, null]);
    expect(ids(moveExercise(list(null, 1, 1, null), 3, -1))).toBe("adbc");
  });
});

describe("previous session", () => {
  const prev = [
    { weight: 135, reps: 10, durationS: null, distanceM: null },
    { weight: 185, reps: 5, durationS: null, distanceM: null },
  ];

  it("picks the same position, else the last", () => {
    expect(pickPrevious(prev, 0)).toBe(prev[0]);
    expect(pickPrevious(prev, 1)).toBe(prev[1]);
    expect(pickPrevious(prev, 5)).toBe(prev[1]);
    expect(pickPrevious([], 0)).toBeUndefined();
  });

  it("prefills a first set from it, keeping the unit and dropping rpe", () => {
    const out = prefillSet({ kind: "normal", weight: 100, unit: "kg", reps: 5, rpe: 9 }, "lb");
    expect(out).toMatchObject({ weight: 100, unit: "kg", reps: 5, rpe: null });
    expect(prefillSet(undefined, "kg").unit).toBe("kg");
  });

  it("formats ghost text", () => {
    expect(formatPrevious(prev[1]!)).toBe("185×5");
    expect(formatPrevious({ weight: 22.5, reps: 8, durationS: null, distanceM: null })).toBe("22.5×8");
    expect(formatPrevious({ weight: null, reps: 12, durationS: null, distanceM: null })).toBe("12 reps");
    expect(formatPrevious({ weight: null, reps: null, durationS: 90, distanceM: null })).toBe("1:30");
    expect(formatPrevious({ weight: 50, reps: null, durationS: 45, distanceM: null })).toBe("50×0:45");
    expect(formatPrevious({ weight: null, reps: null, durationS: null, distanceM: 400 })).toBe("400 m");
    expect(formatPrevious({ weight: null, reps: null, durationS: null, distanceM: null })).toBeNull();
  });
});

describe("rpe + unit", () => {
  it("offers 6-10 in half steps", () => {
    expect(RPE_VALUES).toEqual([6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10]);
    expect(isRpe(8.5)).toBe(true);
    expect(isRpe(5)).toBe(false);
    expect(isRpe(8.25)).toBe(false);
    expect(isRpe(null)).toBe(false);
    expect(formatRpe(8)).toBe("8");
    expect(formatRpe(8.5)).toBe("8.5");
  });

  it("parses the stored unit", () => {
    expect(parseUnit("kg")).toBe("kg");
    expect(parseUnit("lb")).toBe("lb");
    expect(parseUnit(null)).toBe("lb");
    expect(parseUnit("stone", "kg")).toBe("kg");
  });
});

describe("planFinish", () => {
  const ex = (id: string, done: number[]) => ({ id, sets: done.map((d, i) => ({ id: `${id}${i}`, completed: d })) });

  it("discards with nothing done and touches no rows", () => {
    expect(planFinish([ex("a", [0, 0])])).toEqual({ decision: "discard", deleteSetIds: [], deleteExerciseIds: [] });
    expect(planFinish([])).toEqual({ decision: "discard", deleteSetIds: [], deleteExerciseIds: [] });
  });

  it("finishes, dropping unchecked sets and emptied exercises", () => {
    expect(planFinish([ex("a", [1, 0]), ex("b", [0]), ex("c", [1]), ex("d", [])])).toEqual({
      decision: "finish",
      deleteSetIds: ["a1", "b0"],
      deleteExerciseIds: ["b", "d"],
    });
  });

  it("counts unchecked sets for the confirm", () => {
    expect(countUncompleted([ex("a", [1, 0]), ex("b", [0, 0])])).toBe(3);
  });
});
