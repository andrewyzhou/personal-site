import { describe, expect, it } from "vitest";
import { emptyProgram, programProgress, type ProgressionRule, type SessionSet } from "lift-core";
import {
  addWeek,
  daysPerWeek,
  plannedWithTarget,
  progressLabel,
  progressionHint,
  pruneRules,
  removeWeek,
  ruleFor,
  setDay,
  setDayCount,
  setRule,
  targetFromHistory,
} from "../programs";
import type { PlannedSet } from "../templates";

const s = (weight: number, reps: number, completed = 1, kind: SessionSet["kind"] = "normal"): SessionSet => ({ kind, weight, unit: "lb", reps, completed });
const linear: ProgressionRule = { kind: "linear", sets: 3, reps: 5 };

describe("grid edits", () => {
  it("add week copies the last one; remove drops by index", () => {
    let p = setDay(emptyProgram(1, 3), 0, 1, "push");
    p = addWeek(p);
    expect(p.weeks).toHaveLength(2);
    expect(p.weeks[1]!.days.map((d) => d.templateId)).toEqual([null, "push", null]);
    // a copy, not the same objects
    p = setDay(p, 1, 1, "pull");
    expect(p.weeks[0]!.days[1]!.templateId).toBe("push");
    expect(removeWeek(p, 0).weeks[0]!.days[1]!.templateId).toBe("pull");
    expect(removeWeek(p, 9)).toBe(p);
    expect(addWeek(emptyProgram(0)).weeks).toEqual([{ days: [{ templateId: null }] }]);
  });

  it("day count pads with rest days and cuts extras, within 1..14", () => {
    const p = setDay(emptyProgram(2, 3), 0, 2, "legs");
    expect(daysPerWeek(setDayCount(p, 5))).toBe(5);
    expect(setDayCount(p, 5).weeks[0]!.days[2]!.templateId).toBe("legs");
    expect(setDayCount(p, 2).weeks[0]!.days).toHaveLength(2);
    expect(daysPerWeek(setDayCount(p, 0))).toBe(1);
    expect(daysPerWeek(setDayCount(p, 99))).toBe(14);
  });

  it("setDay ignores a missing week and pads a short one", () => {
    const p = emptyProgram(1, 1);
    expect(setDay(p, 3, 0, "x")).toBe(p);
    expect(setDay(p, 0, 2, "x").weeks[0]!.days.map((d) => d.templateId)).toEqual([null, null, "x"]);
  });

  it("rules: set, clear, prune", () => {
    let p = setRule(emptyProgram(), "te1", linear);
    p = setRule(p, "te2", linear);
    expect(Object.keys(setRule(p, "te1", null).rules)).toEqual(["te2"]);
    expect(Object.keys(pruneRules(p, new Set(["te2", "zzz"])).rules)).toEqual(["te2"]);
  });
});

describe("progression on a template", () => {
  const refs = [
    { id: "te1", exerciseId: "bench" },
    { id: "te2", exerciseId: "row" },
    { id: "te3", exerciseId: "bench" },
  ];

  it("ruleFor finds the first ruled entry for the exercise", () => {
    expect(ruleFor({ te3: linear }, refs, "bench")).toBe(linear);
    expect(ruleFor({ te2: linear }, refs, "bench")).toBeNull();
  });

  it("plannedWithTarget keeps warm-ups and swaps the working sets", () => {
    const planned: PlannedSet[] = [
      { kind: "warmup", weight: 95, unit: "lb", reps: 8, durationS: null, distanceM: null },
      { kind: "normal", weight: 185, unit: "lb", reps: 5, durationS: null, distanceM: null },
    ];
    const target = targetFromHistory(linear, [[s(185, 5), s(185, 5), s(185, 5)]], "lb");
    const out = plannedWithTarget(planned, target);
    expect(out.map((p) => [p.kind, p.weight, p.reps])).toEqual([
      ["warmup", 95, 8],
      ["normal", 190, 5],
      ["normal", 190, 5],
      ["normal", 190, 5],
    ]);
    // first session: no weight yet, the template stands
    expect(plannedWithTarget(planned, targetFromHistory(linear, [], "lb"))).toEqual(planned);
    expect(plannedWithTarget(planned, null)).toEqual(planned);
  });

  it("targetFromHistory feeds older sessions in as the deload streak", () => {
    const miss = [s(185, 5), s(185, 4), s(185, 3)];
    expect(targetFromHistory(linear, [miss, miss, miss], "lb").action).toBe("deload");
    expect(targetFromHistory(linear, [miss], "lb").action).toBe("repeat");
  });
});

describe("progressionHint", () => {
  const history = [[s(185, 5), s(185, 5), s(185, 5)]];

  it("before the working sets are done: today's target and why", () => {
    const current = [s(95, 8, 1, "warmup"), s(190, 5, 1), s(190, 5, 0), s(190, 5, 0)];
    expect(progressionHint(linear, current, history, "lb")).toBe("today: 190 lb × 5 · +5 lb: hit 3×5 last time");
  });

  it("once every working set is checked: next time", () => {
    const current = [s(95, 8, 0, "warmup"), s(190, 5), s(190, 5), s(190, 5)];
    expect(progressionHint(linear, current, history, "lb")).toBe("next: 195 lb × 5");
    const missed = [s(190, 5), s(190, 5), s(190, 3)];
    expect(progressionHint(linear, missed, history, "lb")).toBe("next: 190 lb × 5");
  });

  it("no history yet", () => {
    expect(progressionHint(linear, [s(0, 0, 0)], [], "lb")).toBe("today: first session: pick a weight");
  });
});

describe("progressLabel", () => {
  it("reads like the list subtitle", () => {
    const p = setDay(setDay(emptyProgram(2, 2), 0, 0, "a"), 1, 1, "b");
    expect(progressLabel(programProgress(p, []))).toBe("week 1 · day 1 · 0/2");
    expect(progressLabel(programProgress(p, [{ templateId: "a", startedAt: 1 }]))).toBe("week 2 · day 2 · 1/2");
    expect(progressLabel(programProgress(p, [{ templateId: "a", startedAt: 1 }, { templateId: "b", startedAt: 2 }]))).toBe("finished · 2/2");
    expect(progressLabel(programProgress({ ...p, repeat: true }, [{ templateId: "a", startedAt: 1 }, { templateId: "b", startedAt: 2 }]))).toBe(
      "week 1 · day 1 · 0/2 · round 2"
    );
    expect(progressLabel(programProgress(emptyProgram(1, 3), []))).toBe("no training days yet");
  });
});
