import { describe, expect, it } from "vitest";
import { countByDay, dayKey, monthGrid, monthLabel, monthOf, sameMonth, shiftMonth, weekdayLabels } from "../calendar";

const days = (weeks: ReturnType<typeof monthGrid>) => weeks.map((w) => w.map((c) => (c ? c.day : 0)));

describe("monthGrid", () => {
  it("pads a sunday-first month (november 2026 starts on a sunday)", () => {
    const g = monthGrid({ year: 2026, month: 10 });
    expect(g).toHaveLength(5);
    expect(days(g)[0]).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(days(g)[4]).toEqual([29, 30, 0, 0, 0, 0, 0]);
    expect(g[0]![0]).toEqual({ key: "2026-11-01", day: 1 });
  });

  it("supports monday-first", () => {
    const g = monthGrid({ year: 2026, month: 10 }, 1);
    expect(days(g)[0]).toEqual([0, 0, 0, 0, 0, 0, 1]);
    expect(g).toHaveLength(6);
  });

  it("handles leap february and six-week months", () => {
    const feb = monthGrid({ year: 2028, month: 1 });
    expect(feb.flat().filter(Boolean)).toHaveLength(29);
    // august 2026 starts on a saturday: 1 + 30 days spill into a sixth row
    const aug = monthGrid({ year: 2026, month: 7 });
    expect(aug).toHaveLength(6);
    expect(days(aug)[0]).toEqual([0, 0, 0, 0, 0, 0, 1]);
    for (const w of aug) expect(w).toHaveLength(7);
  });
});

describe("month helpers", () => {
  it("shifts across years", () => {
    expect(shiftMonth({ year: 2026, month: 0 }, -1)).toEqual({ year: 2025, month: 11 });
    expect(shiftMonth({ year: 2026, month: 11 }, 1)).toEqual({ year: 2027, month: 0 });
    expect(shiftMonth({ year: 2026, month: 5 }, -18)).toEqual({ year: 2024, month: 11 });
    expect(sameMonth({ year: 2026, month: 1 }, shiftMonth({ year: 2025, month: 1 }, 12))).toBe(true);
  });

  it("labels", () => {
    expect(monthLabel({ year: 2026, month: 10 })).toBe("november 2026");
    expect(weekdayLabels()).toEqual(["s", "m", "t", "w", "t", "f", "s"]);
    expect(weekdayLabels(1)).toEqual(["m", "t", "w", "t", "f", "s", "s"]);
  });

  it("keys by local day", () => {
    const ms = new Date(2026, 10, 4, 23, 59).getTime();
    expect(dayKey(ms)).toBe("2026-11-04");
    expect(monthOf(ms)).toEqual({ year: 2026, month: 10 });
    const counts = countByDay([ms, new Date(2026, 10, 4, 6).getTime(), new Date(2026, 10, 5, 0, 1).getTime()], dayKey);
    expect(counts.get("2026-11-04")).toBe(2);
    expect(counts.get("2026-11-05")).toBe(1);
  });
});
