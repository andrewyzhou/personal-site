import { describe, expect, it } from "vitest";
import {
  addDays,
  buildFigure,
  codeLevel,
  dayLabel,
  figureRanges,
  loudEvents,
  minutesLabel,
  pastYearRange,
  placeLabels,
  quietLevel,
  weekday,
  workoutLevel,
  yearRange,
  type FigureEvent,
  type FigureKind,
} from "../figure";

const ev = (kind: FigureKind, date: string, amount?: number, label: string = kind): FigureEvent => ({ kind, date, label, amount });
const all = new Set<FigureKind>(["writing", "library", "workouts", "code"]);

describe("dates", () => {
  it("adds days across months, years and leap days", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-11-01", 7)).toBe("2026-11-08");
  });

  it("knows the weekday without a timezone", () => {
    expect(weekday("2026-11-08")).toBe(0);
    expect(weekday("2026-11-12")).toBe(4);
    expect(weekday("2026-11-14")).toBe(6);
  });

  it("labels a day", () => {
    expect(dayLabel("2026-11-10")).toBe("tue, nov 10, 2026");
  });

  it("writes durations briefly", () => {
    expect(minutesLabel(40)).toBe("40m");
    expect(minutesLabel(60)).toBe("1h");
    expect(minutesLabel(95)).toBe("1h 35m");
  });
});

describe("ranges", () => {
  it("the past year is 53 weeks ending with today's week", () => {
    const r = pastYearRange("2026-11-12");
    expect(r).toEqual({ id: "past", from: "2025-11-09", to: "2026-11-12" });
    expect(buildFigure(r, [], "2026-11-12").weeks).toHaveLength(53);
  });

  it("offers the past year, then each year back to the earliest data", () => {
    expect(figureRanges("2026-11-12", "2025-03-18").map((r) => r.id)).toEqual(["past", "2026", "2025"]);
    expect(figureRanges("2026-11-12", undefined).map((r) => r.id)).toEqual(["past", "2026"]);
    expect(figureRanges("2026-11-12", "2027-01-01").map((r) => r.id)).toEqual(["past", "2026"]);
  });
});

describe("levels", () => {
  it("workouts get stronger with time; a session with no time still counts", () => {
    expect(workoutLevel(0, 0)).toBe(0);
    expect(workoutLevel(0, 1)).toBe(1);
    expect(workoutLevel(29, 1)).toBe(1);
    expect(workoutLevel(30, 1)).toBe(2);
    expect(workoutLevel(60, 1)).toBe(3);
    expect(workoutLevel(120, 2)).toBe(4);
  });

  it("code gets stronger with count", () => {
    expect([0, 1, 3, 4, 9, 10, 19, 20, 99].map(codeLevel)).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4]);
  });
});

describe("buildFigure", () => {
  const range = yearRange(2026);
  const events = [
    ev("workouts", "2026-03-02", 45),
    ev("workouts", "2026-03-02", 30),
    ev("code", "2026-03-02", 12),
    ev("code", "2026-03-02", 1),
    ev("writing", "2026-03-02", undefined, "a post"),
    ev("library", "2026-06-15"),
    ev("code", "2025-12-31", 5),
    ev("code", "2027-01-01", 5),
  ];
  const fig = buildFigure(range, events, "2026-11-12");
  const day = (iso: string) => fig.weeks.flat().find((d) => d.date === iso)!;

  it("makes whole sunday-to-saturday weeks covering the year", () => {
    expect(fig.weeks[0][0].date).toBe("2025-12-28");
    expect(fig.weeks.at(-1)!.at(-1)!.date).toBe("2027-01-02");
    expect(fig.weeks.every((w) => w.length === 7 && weekday(w[0].date) === 0)).toBe(true);
  });

  it("marks padding days as out of range and gives them no events", () => {
    expect(day("2025-12-31")).toMatchObject({ inRange: false, events: [], code: 0 });
    expect(day("2027-01-01")).toMatchObject({ inRange: false, events: [] });
    expect(day("2026-01-01").inRange).toBe(true);
  });

  it("sums a day's workouts and code into levels", () => {
    expect(day("2026-03-02")).toMatchObject({ workouts: 3, code: 3 });
    expect(day("2026-03-02").events).toHaveLength(5);
  });

  it("knows which days haven't happened yet", () => {
    expect(day("2026-11-12").future).toBe(false);
    expect(day("2026-11-13").future).toBe(true);
  });

  it("totals each kind inside the range only; code counts contributions", () => {
    expect(fig.totals).toEqual({ writing: 1, library: 1, workouts: 2, code: 13 });
  });

  it("labels each month at the first week that starts in it", () => {
    expect(fig.months.map((m) => m.month)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(fig.months[0].week).toBe(1);
    expect(fig.weeks[fig.months[2].week][0].date).toBe("2026-03-01");
  });

  it("shows only the kinds that are switched on", () => {
    const d = day("2026-03-02");
    expect(quietLevel(d, all)).toBe(3);
    expect(quietLevel({ ...d, code: 1 }, all)).toBe(3);
    expect(quietLevel({ ...d, code: 1 }, new Set<FigureKind>(["code"]))).toBe(1);
    expect(quietLevel(d, new Set<FigureKind>(["writing"]))).toBe(0);
    expect(loudEvents(d, "writing", all).map((e) => e.label)).toEqual(["a post"]);
    expect(loudEvents(d, "writing", new Set<FigureKind>(["code"]))).toEqual([]);
  });
});

describe("placeLabels", () => {
  const opts = { colsPerChar: 0.5 };

  it("gives a lone label the room it wants, ending at its column", () => {
    expect(placeLabels([{ week: 40, text: "twelve chars" }], opts)).toEqual([{ week: 40, text: "twelve chars", row: 0, span: 7 }]);
  });

  it("cuts a title that would run past the left edge", () => {
    const [l] = placeLabels([{ week: 4, text: "a title much longer than five columns" }], opts);
    expect(l.span).toBe(5);
    expect(l.text.endsWith("…")).toBe(true);
    expect(l.text.length).toBeLessThanOrEqual(8);
  });

  it("keeps labels in one row from overlapping by trimming the later one", () => {
    const placed = placeLabels(
      [
        { week: 10, text: "first one" },
        { week: 14, text: "second one here" },
      ],
      opts,
    );
    expect(placed.map((p) => p.row)).toEqual([0, 0]);
    expect(placed[1].span).toBe(4);
    expect(placed[1].week - placed[1].span).toBeGreaterThanOrEqual(placed[0].week);
  });

  it("stacks a label that has no room beside its neighbour", () => {
    const placed = placeLabels(
      [
        { week: 30, text: "earlier post" },
        { week: 31, text: "later post" },
      ],
      opts,
    );
    expect(placed.map((p) => `${p.week}:${p.row}`)).toEqual(["30:0", "31:1"]);
  });

  it("never runs a lower label under the line of a higher one", () => {
    const placed = placeLabels(
      [
        { week: 30, text: "a" },
        { week: 31, text: "bbbbbbbbbb" },
        { week: 34, text: "cccccccccccccccccccc" },
      ],
      opts,
    );
    const c = placed.find((p) => p.week === 34)!;
    expect(c.row).toBe(0);
    // the label at week 31 sits in row 1; its line comes down through row 0 at week 31
    expect(c.week - c.span).toBeGreaterThanOrEqual(31);
  });

  it("leaves a label off when every row is full", () => {
    const placed = placeLabels(
      [
        { week: 30, text: "one" },
        { week: 31, text: "two" },
        { week: 32, text: "three" },
      ],
      opts,
    );
    expect(placed.map((p) => p.week)).toEqual([30, 31]);
  });

  it("handles no posts", () => {
    expect(placeLabels([], opts)).toEqual([]);
  });
});
