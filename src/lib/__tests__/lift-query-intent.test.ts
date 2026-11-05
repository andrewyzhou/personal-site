import { describe, it, expect } from "vitest";
import { parseLiftQuestion, resolveExerciseTerm, normalizeQuestion, type LiftIntent } from "@/lib/lift/query/intent";
import { extractWindow, parseDay, mondayOf } from "@/lib/lift/query/window";

// wednesday
const TODAY = "2026-11-04";

function brief(i: LiftIntent): string {
  if (i.kind === "help" || i.kind === "unknown") return i.kind;
  const s = i.subject;
  let subject: string;
  if (s.type === "any") subject = "any";
  else if (s.type === "region") subject = `region:${s.label}`;
  else {
    const name = resolveExerciseTerm(s.term, [], { strict: i.bare })?.name;
    // a bare word that isn't an exercise gets the same reply as unknown
    if (!name && i.bare) return "unknown";
    subject = `exercise:${name ?? `?${s.term}`}`;
  }
  const w = i.window ? ` [${i.window.label} ${i.window.start}..${i.window.end})` : "";
  return `${i.kind} ${subject}${w}`;
}

const q = (text: string) => brief(parseLiftQuestion(text, TODAY));

describe("time windows", () => {
  it("weeks run monday to sunday", () => {
    expect(mondayOf("2026-11-04")).toBe("2026-11-02");
    expect(mondayOf("2026-11-02")).toBe("2026-11-02");
    expect(mondayOf("2026-11-08")).toBe("2026-11-02");
    expect(extractWindow("this week", TODAY).window).toMatchObject({ start: "2026-11-02", end: "2026-11-09" });
    expect(extractWindow("last week", TODAY).window).toMatchObject({ start: "2026-10-26", end: "2026-11-02" });
  });

  it("months, including the january rollover", () => {
    expect(extractWindow("this month", TODAY).window).toMatchObject({ start: "2026-11-01", end: "2026-12-01" });
    expect(extractWindow("last month", TODAY).window).toMatchObject({ start: "2026-10-01", end: "2026-11-01" });
    expect(extractWindow("last month", "2026-01-15").window).toMatchObject({ start: "2025-12-01", end: "2026-01-01" });
    expect(extractWindow("this month", "2026-12-31").window).toMatchObject({ start: "2026-12-01", end: "2027-01-01" });
  });

  it("days", () => {
    expect(extractWindow("today", TODAY).window).toMatchObject({ start: TODAY, end: "2026-11-05" });
    expect(extractWindow("yesterday", TODAY).window).toMatchObject({ start: "2026-11-03", end: TODAY });
    expect(extractWindow("last 7 days", TODAY).window).toMatchObject({ start: "2026-10-29", end: "2026-11-05", label: "last 7 days" });
    expect(extractWindow("past 2 weeks", TODAY).window).toMatchObject({ start: "2026-10-22", end: "2026-11-05" });
    expect(extractWindow("in the last 1 day", TODAY).window).toMatchObject({ start: TODAY, label: "last 1 day" });
  });

  it("since a date, and dates without a year are never in the future", () => {
    expect(extractWindow("since oct 1", TODAY).window).toMatchObject({ start: "2026-10-01", end: "2026-11-05", label: "since oct 1" });
    expect(extractWindow("since 2026-09-15", TODAY).window).toMatchObject({ start: "2026-09-15" });
    expect(extractWindow("since 9/15", TODAY).window).toMatchObject({ start: "2026-09-15" });
    expect(extractWindow("since 15th september", TODAY).window).toMatchObject({ start: "2026-09-15" });
    expect(extractWindow("since dec 20", TODAY).window).toMatchObject({ start: "2025-12-20", label: "since dec 20 2025" });
    expect(extractWindow("since monday", TODAY).window).toMatchObject({ start: "2026-11-02" });
    expect(parseDay("feb 30", TODAY)).toBeNull();
    expect(parseDay("13/1", TODAY)).toBeNull();
  });

  it("in a month picks the latest one that has started", () => {
    expect(extractWindow("in march", TODAY).window).toMatchObject({ start: "2026-03-01", end: "2026-04-01", label: "in mar" });
    expect(extractWindow("in december", TODAY).window).toMatchObject({ start: "2025-12-01", end: "2026-01-01" });
    expect(extractWindow("in november", TODAY).window).toMatchObject({ start: "2026-11-01" });
    expect(extractWindow("in oct 2025", TODAY).window).toMatchObject({ start: "2025-10-01", label: "in oct 2025" });
    expect(extractWindow("in 2025", TODAY).window).toMatchObject({ start: "2025-01-01", end: "2026-01-01" });
  });

  it("weekdays: bare/on = most recent incl. today, last = before today", () => {
    expect(extractWindow("on wednesday", TODAY).window).toMatchObject({ start: TODAY });
    expect(extractWindow("last wednesday", TODAY).window).toMatchObject({ start: "2026-10-28" });
    expect(extractWindow("monday", TODAY).window).toMatchObject({ start: "2026-11-02", label: "mon nov 2" });
    expect(extractWindow("on oct 30", TODAY).window).toMatchObject({ start: "2026-10-30", end: "2026-10-31" });
  });

  it("cuts the phrase out and leaves the rest", () => {
    expect(extractWindow("what did i bench last week", TODAY).rest).toBe("what did i bench");
    expect(extractWindow("best squat ever", TODAY)).toMatchObject({ window: null, allTime: true, rest: "best squat" });
    expect(extractWindow("squat pr", TODAY)).toMatchObject({ window: null, rest: "squat pr" });
  });
});

describe("normalizeQuestion", () => {
  it("folds case, quotes and punctuation but keeps dates", () => {
    expect(normalizeQuestion("What’s my BENCH PR?!")).toBe("what my bench pr?");
    expect(normalizeQuestion("pull-ups since 2026-10-01")).toBe("pull ups since 2026-10-01");
    expect(normalizeQuestion("squats, since 10/1.")).toBe("squats since 10/1");
  });
});

describe("parseLiftQuestion", () => {
  it("handles the headline questions", () => {
    expect(q("what did i bench last week")).toBe("sets exercise:Bench Press (Barbell) [last week 2026-10-26..2026-11-02)");
    expect(q("squat pr")).toBe("best exercise:Squat (Barbell)");
    expect(q("best deadlift")).toBe("best exercise:Deadlift (Barbell)");
    expect(q("how many workouts this month")).toBe("count any [this month 2026-11-01..2026-12-01)");
    expect(q("last leg day")).toBe("last region:leg");
    expect(q("volume this week")).toBe("volume any [this week 2026-11-02..2026-11-09)");
    expect(q("ohp history")).toBe("history exercise:Overhead Press (Barbell)");
    expect(q("when did i last train back")).toBe("last region:back");
    expect(q("e1rm bench")).toBe("e1rm exercise:Bench Press (Barbell)");
    expect(q("/help")).toBe("help");
  });

  it("help for commands and greetings, unknown for chatter", () => {
    for (const t of ["/start", "/help@liftbot", "help", "?", "hi", "  HELP  "]) expect(q(t)).toBe("help");
    for (const t of ["what's the weather", "thanks", "lol", "how are you", "ok cool"]) expect(q(t)).toBe("unknown");
  });

  it("records and trends need an exercise", () => {
    expect(q("best leg day")).toBe("unknown");
    expect(q("pr this week")).toBe("unknown");
    expect(q("history")).toBe("unknown");
  });

  it("a bare exercise means its latest session, and is resolved strictly", () => {
    const i = parseLiftQuestion("bench", TODAY);
    expect(i).toMatchObject({ kind: "last", bare: true, subject: { type: "exercise", term: "bench" } });
    expect(resolveExerciseTerm("bnech", [], { strict: true })).toBeNull();
    expect(resolveExerciseTerm("bnech press")?.name).toMatch(/Bench Press/);
  });

  it("resolves the owner's custom exercises and boosts what they use", () => {
    const known = [{ id: "custom-abc", name: "Zottman Hammer Thing", uses: 12 }];
    expect(resolveExerciseTerm("zottman hammer thing", known)?.id).toBe("custom-abc");
    expect(resolveExerciseTerm("bench", known)?.name).toBe("Bench Press (Barbell)");
  });

  it("muscle words alone are regions, not lifts", () => {
    expect(q("back")).toBe("last region:back");
    expect(q("legs")).toBe("last region:leg");
    expect(q("back day this week")).toBe("sets region:back [this week 2026-11-02..2026-11-09)");
    expect(q("back squat pr")).toBe("best exercise:Squat (Barbell)");
  });

  // the 40-question sweep: printed so the resolved table can be eyeballed in ci output
  it("resolves a realistic sweep of 40 questions", () => {
    const expected: [string, string][] = [
      ["what did i bench last week", "sets exercise:Bench Press (Barbell) [last week 2026-10-26..2026-11-02)"],
      ["squat pr", "best exercise:Squat (Barbell)"],
      ["best deadlift", "best exercise:Deadlift (Barbell)"],
      ["how many workouts this month", "count any [this month 2026-11-01..2026-12-01)"],
      ["last leg day", "last region:leg"],
      ["volume this week", "volume any [this week 2026-11-02..2026-11-09)"],
      ["ohp history", "history exercise:Overhead Press (Barbell)"],
      ["when did i last train back", "last region:back"],
      ["e1rm bench", "e1rm exercise:Bench Press (Barbell)"],
      ["/help", "help"],
      ["What did I squat yesterday?", "sets exercise:Squat (Barbell) [yesterday 2026-11-03..2026-11-04)"],
      ["what did i do today", "sets any [today 2026-11-04..2026-11-05)"],
      ["what's my bench pr", "best exercise:Bench Press (Barbell)"],
      ["deadlift max", "best exercise:Deadlift (Barbell)"],
      ["heaviest ohp ever", "best exercise:Overhead Press (Barbell)"],
      ["best squat last month", "best exercise:Squat (Barbell) [last month 2026-10-01..2026-11-01)"],
      ["how many leg days this month", "count region:leg [this month 2026-11-01..2026-12-01)"],
      ["how many times did i squat since oct 1", "count exercise:Squat (Barbell) [since oct 1 2026-10-01..2026-11-05)"],
      ["how often do i train chest", "count region:chest"],
      ["how many workouts in october", "count any [in oct 2026-10-01..2026-11-01)"],
      ["workouts last 30 days", "sets any [last 30 days 2026-10-06..2026-11-05)"],
      ["when was my last workout", "last any"],
      ["last workout", "last any"],
      ["when did i last deadlift", "last exercise:Deadlift (Barbell)"],
      ["last time i benched", "last exercise:Bench Press (Barbell)"],
      ["when was my last push day", "last region:push"],
      ["bench", "last exercise:Bench Press (Barbell)"],
      ["bench press history since 9/1", "history exercise:Bench Press (Barbell) [since sep 1 2026-09-01..2026-11-05)"],
      ["squat progress this year", "history exercise:Squat (Barbell) [this year 2026-01-01..2027-01-01)"],
      ["estimated 1rm deadlift", "e1rm exercise:Deadlift (Barbell)"],
      ["1rm ohp last month", "e1rm exercise:Overhead Press (Barbell) [last month 2026-10-01..2026-11-01)"],
      ["volume last week", "volume any [last week 2026-10-26..2026-11-02)"],
      ["bench volume this month", "volume exercise:Bench Press (Barbell) [this month 2026-11-01..2026-12-01)"],
      ["total volume in september", "volume any [in sep 2026-09-01..2026-10-01)"],
      ["leg volume this week", "volume region:leg [this week 2026-11-02..2026-11-09)"],
      ["pull-up pr", "best exercise:Pull Up"],
      ["what did i do on monday", "sets any [mon nov 2 2026-11-02..2026-11-03)"],
      ["lat pulldown last week", "sets exercise:Lat Pulldown (Cable) [last week 2026-10-26..2026-11-02)"],
      ["incline db press pr", "best exercise:Incline Bench Press (Dumbbell)"],
      ["what's the weather like", "unknown"],
    ];
    expect(expected).toHaveLength(40);
    const got = expected.map(([text]) => [text, q(text)] as const);
    console.log(got.map(([t, r]) => `${t.padEnd(42)} -> ${r}`).join("\n"));
    for (let i = 0; i < expected.length; i++) expect(got[i]).toEqual(expected[i]);
  });
});
