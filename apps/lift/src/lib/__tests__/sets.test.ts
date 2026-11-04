import { describe, expect, it } from "vitest";
import { byPosition, lastByPosition, nextKind, nextPosition, prefillSet, setLabels } from "../sets";

describe("prefillSet", () => {
  it("starts empty with no previous set", () => {
    expect(prefillSet(undefined, "kg")).toEqual({
      kind: "normal",
      weight: null,
      unit: "kg",
      reps: null,
      durationS: null,
      distanceM: null,
      rpe: null,
    });
  });

  it("copies load and reps but not rpe", () => {
    const out = prefillSet({ kind: "normal", weight: 225, unit: "lb", reps: 5, rpe: 8 });
    expect(out).toMatchObject({ kind: "normal", weight: 225, unit: "lb", reps: 5, rpe: null });
  });

  it("keeps warmup runs going but resets drop/failure to normal", () => {
    expect(prefillSet({ kind: "warmup", weight: 95 }).kind).toBe("warmup");
    expect(prefillSet({ kind: "drop" }).kind).toBe("normal");
    expect(prefillSet({ kind: "failure" }).kind).toBe("normal");
  });

  it("falls back to the default unit when the previous has none", () => {
    expect(prefillSet({ weight: 20 }, "kg").unit).toBe("kg");
  });
});

describe("ordering", () => {
  it("nextPosition is one past the max, tolerating gaps", () => {
    expect(nextPosition([])).toBe(0);
    expect(nextPosition([{ position: 0 }, { position: 3 }, { position: 1 }])).toBe(4);
  });

  it("lastByPosition picks the highest position", () => {
    expect(lastByPosition([])).toBeUndefined();
    expect(lastByPosition([{ position: 2, id: "b" }, { position: 5, id: "c" }, { position: 0, id: "a" }])?.id).toBe("c");
  });

  it("byPosition sorts ascending", () => {
    expect([{ position: 2 }, { position: 0 }, { position: 1 }].sort(byPosition).map((x) => x.position)).toEqual([0, 1, 2]);
  });
});

describe("kinds", () => {
  it("cycles through all four and wraps", () => {
    expect(nextKind("normal")).toBe("warmup");
    expect(nextKind("warmup")).toBe("drop");
    expect(nextKind("drop")).toBe("failure");
    expect(nextKind("failure")).toBe("normal");
  });

  it("labels number working sets and mark warmups", () => {
    expect(setLabels([{ kind: "warmup" }, { kind: "warmup" }, { kind: "normal" }, { kind: "drop" }])).toEqual([
      "W",
      "W",
      "1",
      "2",
    ]);
  });
});
