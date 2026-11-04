import { describe, expect, it } from "vitest";
import {
  DEFAULT_REST_S,
  MAX_REST_S,
  adjustTimer,
  clampRestS,
  endedJustNow,
  formatRest,
  fractionLeft,
  isOver,
  parseRestTimer,
  remainingMs,
  remainingS,
  resolveRestS,
  shouldStartRest,
  startTimer,
} from "../rest";

const T0 = 1_000_000;

describe("rest durations", () => {
  it("prefers the exercise override, else the default", () => {
    expect(resolveRestS(90, 120)).toBe(90);
    expect(resolveRestS(null, 120)).toBe(120);
    expect(resolveRestS(undefined, 150)).toBe(150);
    expect(resolveRestS(0, 120)).toBe(0);
  });

  it("clamps to 0..max and rounds", () => {
    expect(clampRestS(-5)).toBe(0);
    expect(clampRestS(90.4)).toBe(90);
    expect(clampRestS(10_000)).toBe(MAX_REST_S);
    expect(clampRestS(Number.NaN)).toBe(DEFAULT_REST_S);
  });
});

describe("timer math", () => {
  it("counts down from start", () => {
    const t = startTimer(120, T0, "we1");
    expect(t).toEqual({ endsAt: T0 + 120_000, durationS: 120, workoutExerciseId: "we1" });
    expect(remainingMs(t, T0 + 30_000)).toBe(90_000);
    expect(remainingS(t, T0 + 30_500)).toBe(90);
    expect(fractionLeft(t, T0 + 60_000)).toBeCloseTo(0.5);
    expect(isOver(t, T0 + 119_999)).toBe(false);
    expect(isOver(t, T0 + 120_000)).toBe(true);
    expect(remainingMs(t, T0 + 500_000)).toBe(0);
  });

  it("rounds remaining seconds up so 0:00 only shows when over", () => {
    const t = startTimer(10, T0);
    expect(remainingS(t, T0 + 9_001)).toBe(1);
    expect(remainingS(t, T0 + 10_000)).toBe(0);
  });

  it("+15 extends both the end and the bar total", () => {
    const t = startTimer(120, T0);
    const a = adjustTimer(t, 15, T0 + 60_000)!;
    expect(a.endsAt).toBe(T0 + 135_000);
    expect(a.durationS).toBe(135);
    expect(fractionLeft(a, T0 + 60_000)).toBeCloseTo(75 / 135);
  });

  it("-15 shortens, and past zero means over", () => {
    const t = startTimer(120, T0);
    const a = adjustTimer(t, -15, T0)!;
    expect(a.endsAt).toBe(T0 + 105_000);
    expect(a.durationS).toBe(105);
    expect(adjustTimer(t, -15, T0 + 110_000)).toBeNull();
  });

  it("caps adjustments at the max", () => {
    const t = startTimer(MAX_REST_S, T0);
    expect(adjustTimer(t, 15, T0)!.endsAt).toBe(T0 + MAX_REST_S * 1000);
  });

  it("only a just-ended timer earns the haptic", () => {
    const t = startTimer(60, T0);
    expect(endedJustNow(t, T0 + 59_000)).toBe(false);
    expect(endedJustNow(t, T0 + 60_500)).toBe(true);
    expect(endedJustNow(t, T0 + 600_000)).toBe(false);
  });

  it("formats m:ss", () => {
    expect(formatRest(0)).toBe("0:00");
    expect(formatRest(75)).toBe("1:15");
    expect(formatRest(600)).toBe("10:00");
  });
});

describe("persistence", () => {
  it("round trips and tolerates junk", () => {
    const t = startTimer(90, T0, "x");
    expect(parseRestTimer(JSON.stringify(t))).toEqual(t);
    expect(parseRestTimer(JSON.stringify({ endsAt: T0, durationS: 90 }))).toEqual({
      endsAt: T0,
      durationS: 90,
      workoutExerciseId: null,
    });
    expect(parseRestTimer(null)).toBeNull();
    expect(parseRestTimer("")).toBeNull();
    expect(parseRestTimer("nope")).toBeNull();
    expect(parseRestTimer("null")).toBeNull();
    expect(parseRestTimer('{"endsAt":"soon","durationS":1}')).toBeNull();
    expect(parseRestTimer('{"endsAt":1}')).toBeNull();
  });
});

describe("shouldStartRest", () => {
  const ex = (id: string, group: number | null, done: boolean[]) => ({
    id,
    supersetGroup: group,
    sets: done.map((d, i) => ({ id: `${id}${i + 1}`, completed: d ? 1 : 0 })),
  });

  it("always rests outside a superset", () => {
    expect(shouldStartRest([ex("a", null, [true, false])], "a1")).toBe(true);
  });

  it("waits for the last exercise of the round", () => {
    const list = [ex("a", 1, [true, false]), ex("b", 1, [false, false]), ex("c", null, [false])];
    expect(shouldStartRest(list, "a1")).toBe(false);
    const after = [ex("a", 1, [true, false]), ex("b", 1, [true, false]), ex("c", null, [false])];
    expect(shouldStartRest(after, "b1")).toBe(true);
  });

  it("is order independent within a round", () => {
    expect(shouldStartRest([ex("a", 1, [false]), ex("b", 1, [true])], "b1")).toBe(false);
    expect(shouldStartRest([ex("a", 1, [true]), ex("b", 1, [true])], "a1")).toBe(true);
  });

  it("an exercise with extra sets rests on its own beyond the partner's count", () => {
    const list = [ex("a", 1, [true, true, true]), ex("b", 1, [true, true])];
    expect(shouldStartRest(list, "a3")).toBe(true);
  });

  it("ignores other groups", () => {
    const list = [ex("a", 1, [true]), ex("b", 1, [true]), ex("c", 2, [false]), ex("d", 2, [false])];
    expect(shouldStartRest(list, "b1")).toBe(true);
  });

  it("unknown set: no rest", () => {
    expect(shouldStartRest([ex("a", null, [true])], "zz")).toBe(false);
  });
});
