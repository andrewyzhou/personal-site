import { describe, expect, it } from "vitest";
import {
  checkProgramData,
  emptyProgram,
  formatSlot,
  parseProgramData,
  programProgress,
  programSlots,
  programTemplateIds,
  serializeProgramData,
  type ProgramData,
} from "../programs";

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 10, 2);

function program(weeks: (string | null)[][], over: Partial<ProgramData> = {}): ProgramData {
  return {
    ...emptyProgram(0),
    weeks: weeks.map((days) => ({ days: days.map((templateId) => ({ templateId })) })),
    ...over,
  };
}

const ppl = program(
  [
    ["push", "pull", "legs"],
    ["push", null, "pull", "legs"],
  ],
  { startedAt: T0 }
);
const done = (templateId: string | null, day: number) => ({ templateId, startedAt: T0 + day * DAY });

describe("programProgress", () => {
  it("fresh program: week 1 day 1", () => {
    const p = programProgress(ppl, []);
    expect(p.next).toEqual({ week: 0, day: 0, templateId: "push" });
    expect(p).toMatchObject({ completed: 0, total: 6, fraction: 0, done: false, cycles: 0 });
  });

  it("advances on the expected template, in time order", () => {
    const p = programProgress(ppl, [done("pull", 1), done("push", 0)]);
    expect(p.next).toEqual({ week: 0, day: 2, templateId: "legs" });
    expect(p.completed).toBe(2);
  });

  it("off-program and repeated workouts don't advance", () => {
    const p = programProgress(ppl, [done("push", 0), done("push", 1), done(null, 2), done("arms", 3)]);
    expect(p.next?.templateId).toBe("pull");
  });

  it("rest days are skipped; day index keeps the grid position", () => {
    const p = programProgress(ppl, [done("push", 0), done("pull", 1), done("legs", 2), done("push", 3)]);
    expect(p.next).toEqual({ week: 1, day: 2, templateId: "pull" });
    expect(formatSlot(p.next!)).toBe("week 2 · day 3");
  });

  it("workouts before startedAt don't count", () => {
    const p = programProgress(ppl, [{ templateId: "push", startedAt: T0 - DAY }]);
    expect(p.completed).toBe(0);
  });

  it("finishes after the last day", () => {
    const all = ["push", "pull", "legs", "push", "pull", "legs"].map((t, i) => done(t, i));
    const p = programProgress(ppl, [...all, done("push", 9)]);
    expect(p).toMatchObject({ next: null, done: true, fraction: 1, completed: 6, week: 1, day: 3 });
  });

  it("repeating programs wrap and count cycles", () => {
    const loop = { ...ppl, repeat: true };
    const all = ["push", "pull", "legs", "push", "pull", "legs", "push"].map((t, i) => done(t, i));
    const p = programProgress(loop, all);
    expect(p.next).toEqual({ week: 0, day: 1, templateId: "pull" });
    expect(p).toMatchObject({ cycles: 1, completed: 1, done: false });
  });

  it("skips move it forward without a workout", () => {
    const p = programProgress({ ...ppl, skipped: 2 }, []);
    expect(p.next?.templateId).toBe("legs");
  });

  it("an empty program is done", () => {
    expect(programProgress(emptyProgram(2, 3), []).done).toBe(true);
  });

  it("null startedAt counts everything", () => {
    const p = programProgress({ ...ppl, startedAt: null }, [{ templateId: "push", startedAt: 0 }]);
    expect(p.completed).toBe(1);
  });
});

describe("program data", () => {
  it("slots and template ids", () => {
    expect(programSlots(ppl)).toHaveLength(6);
    expect(programTemplateIds(ppl)).toEqual(["push", "pull", "legs"]);
  });

  it("serialize -> parse round-trips and passes the strict check", () => {
    const p: ProgramData = { ...ppl, rules: { te2: { kind: "double", sets: 3, repsLo: 8, repsHi: 12 }, te1: { kind: "linear", sets: 3, reps: 5 } } };
    const text = serializeProgramData(p);
    expect(parseProgramData(text)).toEqual(p);
    expect(checkProgramData(JSON.parse(text))).toBeNull();
    // stable: rule keys sorted, so the same program is the same text
    expect(text.indexOf('"te1"')).toBeLessThan(text.indexOf('"te2"'));
    expect(serializeProgramData(parseProgramData(text))).toBe(text);
  });

  it("parse tolerates junk", () => {
    expect(parseProgramData("not json")).toEqual(emptyProgram(0));
    expect(parseProgramData(null).weeks).toEqual([]);
    const p = parseProgramData(JSON.stringify({ weeks: [{ days: [{ templateId: "" }, 3, { templateId: "a" }] }, "x"], rules: { a: { kind: "bad" } }, skipped: -1, repeat: "yes" }));
    expect(p.weeks).toEqual([{ days: [{ templateId: null }, { templateId: null }, { templateId: "a" }] }, { days: [] }]);
    expect(p.rules).toEqual({});
    expect(p.skipped).toBe(0);
    expect(p.repeat).toBe(false);
  });

  it("checkProgramData names the problem", () => {
    const ok = JSON.parse(serializeProgramData(ppl));
    expect(checkProgramData(ok)).toBeNull();
    expect(checkProgramData([])).toBe("must be an object");
    expect(checkProgramData({ ...ok, version: 2 })).toBe("version must be 1");
    expect(checkProgramData({ ...ok, weeks: [{ days: [{ templateId: 5 }] }] })).toMatch(/templateId/);
    expect(checkProgramData({ ...ok, weeks: Array.from({ length: 53 }, () => ({ days: [] })) })).toMatch(/at most 52/);
    expect(checkProgramData({ ...ok, rules: { x: { kind: "linear" } } })).toBe("rules.x is not a valid rule");
    expect(checkProgramData({ ...ok, startedAt: -5 })).toMatch(/startedAt/);
    expect(checkProgramData({ ...ok, skipped: 1.5 })).toMatch(/skipped/);
    expect(checkProgramData({ ...ok, repeat: 1 })).toMatch(/repeat/);
  });

  it("emptyProgram is a weeks × days grid of rest days", () => {
    const p = emptyProgram(4, 3);
    expect(p.weeks).toHaveLength(4);
    expect(p.weeks[0]!.days).toEqual([{ templateId: null }, { templateId: null }, { templateId: null }]);
    expect(checkProgramData(p)).toBeNull();
  });
});
