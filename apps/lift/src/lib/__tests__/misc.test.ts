import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { customToExercise, isCustomId, parseRegions } from "../custom";
import { createDebouncedCommit } from "../debounce";
import { decideFinish } from "../finish";
import { defaultWorkoutTitle, formatElapsed, formatList, humanize } from "../format";
import { flushOnAppState, flushPendingWrites, registerFlush } from "../pending";
import { toUsageMap } from "../usage";

describe("decideFinish", () => {
  it("discards when nothing is completed", () => {
    expect(decideFinish([])).toBe("discard");
    expect(decideFinish([{ completed: 0 }, { completed: false }])).toBe("discard");
  });
  it("finishes with at least one completed set", () => {
    expect(decideFinish([{ completed: 0 }, { completed: 1 }])).toBe("finish");
    expect(decideFinish([{ completed: true }])).toBe("finish");
  });
});

describe("format", () => {
  it("humanizes ids", () => {
    expect(humanize("front_delts")).toBe("front delts");
    expect(formatList(["lats", "upper_back"])).toBe("lats, upper back");
  });
  it("formats elapsed time", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(65_000)).toBe("1:05");
    expect(formatElapsed(3_723_000)).toBe("1:02:03");
    expect(formatElapsed(-5000)).toBe("0:00");
  });
  it("titles by time of day", () => {
    expect(defaultWorkoutTitle(new Date(2026, 0, 1, 7))).toBe("morning workout");
    expect(defaultWorkoutTitle(new Date(2026, 0, 1, 18))).toBe("evening workout");
    expect(defaultWorkoutTitle(new Date(2026, 0, 1, 2))).toBe("night workout");
  });
});

describe("createDebouncedCommit", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("commits only the last value after the delay", () => {
    const commit = vi.fn();
    const d = createDebouncedCommit(commit, 300);
    d.set("2");
    d.set("22");
    d.set("22,5");
    vi.advanceTimersByTime(299);
    expect(commit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(commit).toHaveBeenCalledExactlyOnceWith("22,5");
  });

  it("flush writes immediately and only once", () => {
    const commit = vi.fn();
    const d = createDebouncedCommit(commit, 300);
    d.set("5");
    expect(d.pending).toBe(true);
    d.flush();
    d.flush();
    vi.advanceTimersByTime(1000);
    expect(commit).toHaveBeenCalledExactlyOnceWith("5");
    expect(d.pending).toBe(false);
  });

  it("cancel drops the pending value", () => {
    const commit = vi.fn();
    const d = createDebouncedCommit(commit, 300);
    d.set("5");
    d.cancel();
    d.flush();
    vi.advanceTimersByTime(1000);
    expect(commit).not.toHaveBeenCalled();
  });
});

describe("pending registry", () => {
  it("flushes every registered input until unregistered", () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = registerFlush(a);
    const offB = registerFlush(b);
    flushPendingWrites();
    offA();
    flushPendingWrites();
    offB();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
  });

  it("flushes when the app goes inactive or background, not when active", () => {
    const f = vi.fn();
    const off = registerFlush(f);
    flushOnAppState("active");
    expect(f).not.toHaveBeenCalled();
    flushOnAppState("inactive");
    flushOnAppState("background");
    off();
    expect(f).toHaveBeenCalledTimes(2);
  });
});

describe("usage + custom", () => {
  it("builds a usage map", () => {
    expect(toUsageMap([{ exerciseId: "a", count: 3 }, { exerciseId: "b", count: 1 }])).toEqual({ a: 3, b: 1 });
  });

  it("maps custom rows and tolerates bad json", () => {
    expect(parseRegions("not json")).toEqual([]);
    expect(parseRegions('{"a":1}')).toEqual([]);
    const ex = customToExercise({
      id: "custom-1",
      name: "Landmine Press",
      equipment: "barbell",
      tracking: "weight_reps",
      primary: '["front_delts"]',
      secondary: '["triceps", 3]',
    });
    expect(ex).toMatchObject({ primary: ["front_delts"], secondary: ["triceps"], aliases: [], curated: false });
    expect(isCustomId(ex.id)).toBe(true);
    expect(isCustomId("bench-press-barbell")).toBe(false);
  });
});
