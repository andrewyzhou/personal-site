import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { publicLiftId } from "@/lib/lift/public-id";
import { addDays, localToUtc, safeTimezone, utcToLocal } from "@/lib/lift/time";
import {
  MAX_DETAILS,
  truncateText,
  formatExerciseLine,
  formatIngestDetails,
  formatIngestSummary,
  formatLocalDay,
  formatSets,
  formatVolume,
  formatWatch,
  sportLabel,
  workoutUrl,
  type LinkedActivity,
} from "@/lib/lift/summary";
import { timingFromLinks, type LinkedRecording } from "@/lib/lift/link";
import { bearerMatches, safeEqual } from "@/lib/lift/auth";
import { extractIncomingText, parseChatAllowlist } from "@/lib/lift/telegram";
import { planShareIngest, type ExerciseLine, type IngestSummary, type SetBrief } from "@/lib/lift/plan";

// the owner's real share from 2026-11-02 (lift_ingests raw_text), byte for byte
const FULL_BODY_B =
  "Full Body B\nMonday, November 2, 2026 at 7:18 PM\n\nSquat (Barbell)\nW1: 45 lb × 6 [Warm-up]\nW2: 135 lb × 4 [Warm-up]\n" +
  "Set 1: 185 lb × 5\nSet 2: 185 lb × 5\n\nDeadlift (Barbell)\nSet 1: 185 lb × 5\nSet 2: 185 lb × 4\n\n" +
  "Bicep Curl (Dumbbell)\nSet 1: 35 lb × 6\nSet 2: 35 lb × 7\n\nhttps://example.com/w/caterxeu\n";

const LB = 2.2046226218;

describe("lift time", () => {
  it("maps wall clock to utc across dst", () => {
    expect(localToUtc("2026-07-01T09:00", "America/Los_Angeles")).toEqual({
      date: new Date("2026-07-01T16:00:00Z"),
      utcOffsetMin: -420,
    });
    expect(localToUtc("2026-11-04T18:12", "America/Los_Angeles")!.date.toISOString()).toBe("2026-11-05T02:12:00.000Z");
    // the morning after spring-forward
    expect(localToUtc("2026-03-08T12:00", "America/Los_Angeles")!.utcOffsetMin).toBe(-420);
    expect(localToUtc("2026-03-07T12:00", "America/Los_Angeles")!.utcOffsetMin).toBe(-480);
    expect(localToUtc("2026-06-01T08:00", "Asia/Kolkata")!.utcOffsetMin).toBe(330);
    expect(localToUtc("2026-06-01T08:00", "UTC")!.date.toISOString()).toBe("2026-06-01T08:00:00.000Z");
  });

  it("rejects malformed input", () => {
    expect(localToUtc("nov 4", "UTC")).toBeNull();
  });

  it("falls back to los angeles for an unknown zone in both directions", () => {
    expect(safeTimezone("Not/AZone")).toBe("America/Los_Angeles");
    expect(safeTimezone("")).toBe("America/Los_Angeles");
    expect(safeTimezone("Asia/Kolkata")).toBe("Asia/Kolkata");
    expect(localToUtc("2026-11-04T18:12", "Not/AZone")).toEqual(localToUtc("2026-11-04T18:12", "America/Los_Angeles"));
    expect(() => utcToLocal(new Date("2026-11-05T02:12:00Z"), "Not/AZone")).not.toThrow();
    expect(utcToLocal(new Date("2026-11-05T02:12:00Z"), "Not/AZone")).toBe("2026-11-04T18:12");
  });

  it("round-trips utc to wall clock", () => {
    expect(utcToLocal(new Date("2026-11-05T02:12:00Z"), "America/Los_Angeles")).toBe("2026-11-04T18:12");
  });

  it("adds days across month and year ends", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });
});

const SUMMARY: IngestSummary = {
  title: "Push Day",
  startedLocal: "2026-11-04T18:12",
  exerciseCount: 2,
  workingSets: 4,
  volumeKg: 1850 / LB,
  unit: "lb",
  exercises: [],
};

const PRIMARY: LinkedActivity = {
  activityId: 1,
  role: "primary",
  method: "auto",
  deltaMin: -2,
  sportType: "WeightTraining",
  localTime: "18:10",
};

describe("lift summary text", () => {
  it("formats the bot/api one-liner", () => {
    expect(formatIngestSummary(SUMMARY, [PRIMARY])).toBe(
      "logged push day · wed nov 4 · 2 exercises · 4 sets · 1,850 lb · watch: linked (weight training 18:10)"
    );
  });

  it("covers unlinked, duplicate, singular and continuation cases", () => {
    const one = { ...SUMMARY, exerciseCount: 1, workingSets: 1 };
    expect(formatIngestSummary(one, [], { duplicate: true })).toBe(
      "already logged push day · wed nov 4 · 1 exercise · 1 set · 1,850 lb · watch: not linked yet"
    );
    const cont: LinkedActivity = { ...PRIMARY, activityId: 2, role: "continuation", localTime: "18:55" };
    const dup: LinkedActivity = { ...PRIMARY, activityId: 3, role: "duplicate", sportType: "Workout" };
    expect(formatIngestSummary(SUMMARY, [PRIMARY, cont, dup])).toMatch(/watch: linked \(weight training 18:10 \+1 more\)$/);
  });

  it("drops tonnage for bodyweight-only days and handles kg", () => {
    expect(formatIngestSummary({ ...SUMMARY, volumeKg: 0 }, [])).not.toMatch(/ lb/);
    expect(formatVolume(1234.4, "kg")).toBe("1,234 kg");
  });

  it("never names an outside service", () => {
    const text = formatIngestSummary(SUMMARY, [PRIMARY, { ...PRIMARY, activityId: 9, role: "duplicate" }]);
    expect(text.toLowerCase()).not.toMatch(/strava|garmin|intervals/);
  });

  it("formats days and sport labels", () => {
    expect(formatLocalDay("2026-01-01T07:00")).toBe("thu jan 1");
    expect(sportLabel("WeightTraining")).toBe("weight training");
    expect(sportLabel("Workout")).toBe("workout");
  });
});

function brief(over: Partial<SetBrief> = {}): SetBrief {
  return { weight: null, unit: null, reps: null, durationS: null, distance: null, distanceUnit: null, bodyweight: false, ...over };
}
const lb = (weight: number, reps: number) => brief({ weight, unit: "lb", reps });

describe("lift details text", () => {
  const env = { ...process.env };
  beforeEach(() => {
    process.env = { ...env, LIFT_PUBLIC_ID_SECRET: "test-secret" };
  });
  afterEach(() => {
    process.env = { ...env };
  });
  const liftUrl = (id: string) => `https://www.andrewzhou.org/lifts/${publicLiftId(id)}`;
  const plan = planShareIngest(FULL_BODY_B, { source: "telegram", timezone: "America/Los_Angeles" });
  const summary = plan.summary!;
  const WEIGHTS: LinkedActivity = { ...PRIMARY, activityId: 16712345678, localTime: "19:16" };

  it("2026-11-02 (real): full body b, lift-only, links the lift page", () => {
    expect(plan.workout!.workout.id).toBe("share-caterxeu");
    expect(formatIngestDetails(summary, [], { workoutId: "share-caterxeu", warnings: plan.warnings })).toBe(
      [
        "logged full body b · mon nov 2 · 3 exercises · 6 sets · 3,970 lb · watch: not linked yet",
        "squat (barbell): 2×5 @ 185 lb · top e1rm 216 lb",
        "deadlift (barbell): 185×5, 185×4 lb · top e1rm 216 lb",
        "bicep curl (dumbbell): 35×6, 35×7 lb · top e1rm 43 lb",
        liftUrl("share-caterxeu"),
      ].join("\n")
    );
  });

  it("never puts the internal id or share slug in the reply", () => {
    const text = formatIngestDetails(summary, [], { workoutId: "share-caterxeu", warnings: plan.warnings });
    expect(text).not.toContain("caterxeu");
    expect(text).toContain("/lifts/");
  });

  it("leaves the lift link out when there's no public id secret", () => {
    delete process.env.LIFT_PUBLIC_ID_SECRET;
    delete process.env.AUTH_SECRET;
    expect(workoutUrl("share-caterxeu", [])).toBeNull();
    const text = formatIngestDetails(summary, [], { workoutId: "share-caterxeu" });
    expect(text).not.toContain("/lifts/");
    expect(text).not.toContain("caterxeu");
    // a linked one still points at its recording
    expect(workoutUrl("share-caterxeu", [WEIGHTS])).toBe("https://www.andrewzhou.org/activities/16712345678");
  });

  it("leaves the link out when the links couldn't be read", () => {
    const text = formatIngestDetails(summary, [], { workoutId: "share-caterxeu", linksUnknown: true });
    expect(text).not.toMatch(/https:/);
  });

  it("links the watch recording when there is one, and says updated for an edit", () => {
    const text = formatIngestDetails(summary, [WEIGHTS], { workoutId: "share-caterxeu", updated: true });
    const lines = text.split("\n");
    expect(lines[0]).toMatch(/^updated full body b · mon nov 2 · .* · watch: linked \(weight training 19:16\)$/);
    expect(lines.at(-1)).toBe(
      "https://www.andrewzhou.org/activities/16712345678"
    );
    expect(text.toLowerCase()).not.toMatch(/strava|garmin|intervals/);
  });

  it("points any linked recording at its page, preferring primary then overrun", () => {
    expect(workoutUrl("share-x", [{ ...PRIMARY, role: "overrun", activityId: 5 }])).toBe(
      "https://www.andrewzhou.org/activities/5"
    );
    // a lift-only url for a linked workout would 404, so even a duplicate link wins
    expect(workoutUrl("share-x", [{ ...PRIMARY, role: "duplicate", activityId: 7 }])).toBe("https://www.andrewzhou.org/activities/7");
    expect(
      workoutUrl("share-x", [
        { ...PRIMARY, role: "continuation", activityId: 8 },
        { ...PRIMARY, role: "primary", activityId: 9 },
      ])
    ).toBe("https://www.andrewzhou.org/activities/9");
    expect(workoutUrl("share-x", [])).toBe(liftUrl("share-x"));
  });

  it("truncates without splitting an emoji", () => {
    expect(truncateText("abc", 3)).toBe("abc");
    expect(truncateText("abcd", 3)).toBe("ab…");
    // "a" + 💪 (two utf-16 units) + "b": cutting at 3 must not keep half the emoji
    const cut = truncateText("a\u{1F4AA}b", 3);
    expect(cut).toBe("a…");
    expect(cut.length).toBeLessThanOrEqual(3);
    expect(truncateText("\u{1F4AA}".repeat(10), 7)).toBe("\u{1F4AA}".repeat(3) + "…");
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(truncateText("x\u{1F4AA}".repeat(50), 100))).toBe(false);
  });

  it("counts skipped lines and keeps planner notes", () => {
    const text = formatIngestDetails(summary, [], {
      workoutId: "w",
      warnings: [
        { line: 7, message: "unrecognized set line", text: "Set 3: ???" },
        { line: 9, message: "unrecognized set line", text: "???" },
        { line: 0, message: "no workout date found; using the time it was received", text: "" },
      ],
    });
    expect(text.split("\n").slice(-2)).toEqual([
      "2 lines skipped",
      "no workout date found; using the time it was received",
    ]);
  });

  it("groups identical sets and lists mixed ones", () => {
    expect(formatSets([lb(185, 5), lb(185, 5), lb(185, 5)])).toBe("3×5 @ 185 lb");
    expect(formatSets([lb(185, 5), lb(175, 6), lb(165, 8)])).toBe("185×5, 175×6, 165×8 lb");
    expect(formatSets([lb(185, 5), lb(185, 5), lb(165, 8)])).toBe("185×5 ×2, 165×8 lb");
    expect(formatSets([brief({ weight: 100, unit: "kg", reps: 3 }), lb(225, 3)])).toBe("100 kg×3, 225 lb×3");
    expect(formatSets([brief({ reps: 12, bodyweight: true }), brief({ reps: 12, bodyweight: true })])).toBe("2×12");
    expect(formatSets([brief({ reps: 12, bodyweight: true }), brief({ weight: 25, unit: "lb", reps: 8, bodyweight: true })])).toBe(
      "12, +25×8 lb"
    );
    expect(formatSets([brief({ durationS: 60 }), brief({ durationS: 60 })])).toBe("2×1:00");
    expect(formatSets([brief({ weight: 70, unit: "kg", distance: 40, distanceUnit: "m" })])).toBe("1×70 kg 40 m");
    expect(formatSets([])).toBe("warm-up only");
  });

  it("only estimates a max from absolute loads", () => {
    const line = (sets: SetBrief[]): string =>
      formatExerciseLine({ name: "Pull Up", sets } as ExerciseLine, "lb");
    expect(line([brief({ weight: 25, unit: "lb", reps: 8, bodyweight: true })])).toBe("pull up: 1×8 @ +25 lb");
    expect(line([brief({ weight: 100, unit: "kg", reps: 1 })])).toBe("pull up: 1×1 @ 100 kg · top e1rm 100 kg");
    // past 15 reps there's no estimate
    expect(line([lb(95, 20)])).toBe("pull up: 1×20 @ 95 lb");
  });

  it("stays under one telegram message, trimming exercises as +N more", () => {
    const many: ExerciseLine[] = Array.from({ length: 100 }, (_, i) => ({
      ...summary.exercises[0],
      name: `Exercise Number ${i} With A Fairly Long Name (Machine)`,
      sets: [lb(100, 10), lb(110, 8), lb(120, 6), lb(130, 4), lb(140, 2)],
    }));
    const text = formatIngestDetails({ ...summary, exercises: many, exerciseCount: 100 }, [], { workoutId: "w" });
    expect(text.length).toBeLessThanOrEqual(MAX_DETAILS);
    const lines = text.split("\n");
    const more = lines.find((l) => /^\+\d+ more$/.test(l))!;
    const shown = lines.filter((l) => l.startsWith("exercise number")).length;
    expect(shown + Number(more.slice(1, -5))).toBe(100);
    expect(lines.at(-1)).toBe(liftUrl("w"));
  });
});

function rec(over: Partial<LinkedRecording>): LinkedRecording {
  return {
    ...PRIMARY,
    startDateUtc: new Date("2026-11-05T02:10:00Z"),
    utcOffsetMin: -480,
    elapsedS: 3000,
    ...over,
  };
}

describe("timingFromLinks", () => {
  it("spans the primary and any continuations, ignoring duplicates", () => {
    const t = timingFromLinks([
      rec({}),
      rec({ activityId: 2, role: "continuation", startDateUtc: new Date("2026-11-05T03:05:00Z"), elapsedS: 600 }),
      rec({ activityId: 3, role: "duplicate", startDateUtc: new Date("2026-11-05T02:11:00Z"), elapsedS: 99999 }),
    ]);
    expect(t).toEqual({
      startedAt: new Date("2026-11-05T02:10:00Z"),
      utcOffsetMin: -480,
      endedAt: new Date("2026-11-05T03:15:00Z"),
      durationS: 65 * 60,
    });
  });

  it("2026-11-02 (real): an overrun link pins the start from the workout's wall time and the watch offset", () => {
    const overrun = rec({
      activityId: 496,
      role: "overrun",
      deltaMin: -317,
      localTime: "14:01",
      startDateUtc: new Date("2026-11-02T22:01:00Z"),
      utcOffsetMin: -480,
      elapsedS: 21909,
    });
    expect(timingFromLinks([overrun], "2026-11-02T19:18")).toEqual({
      startedAt: new Date("2026-11-03T03:18:00Z"),
      utcOffsetMin: -480,
      endedAt: null,
      durationS: null,
    });
    expect(timingFromLinks([overrun])).toBeNull();
    expect(formatWatch([overrun])).toBe("watch: linked (inside weight training from 14:01)");
  });

  it("is null without a primary", () => {
    expect(timingFromLinks([rec({ role: "duplicate" })])).toBeNull();
    expect(timingFromLinks([])).toBeNull();
  });
});

describe("lift auth + telegram helpers", () => {
  it("compares secrets safely and fails closed", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abcd", "abc")).toBe(false);
    expect(safeEqual("", "")).toBe(false);
    expect(safeEqual(null, "abc")).toBe(false);
    expect(bearerMatches("Bearer abc", "abc")).toBe(true);
    expect(bearerMatches("bearer  abc", "abc")).toBe(true);
    expect(bearerMatches("abc", "abc")).toBe(false);
    expect(bearerMatches("Bearer abc", undefined)).toBe(false);
    expect(bearerMatches(null, "abc")).toBe(false);
  });

  it("extracts text or caption from messages and edits only", () => {
    expect(extractIncomingText({ message: { message_id: 5, chat: { id: 42 }, text: "hi" } })).toEqual({
      chatId: 42,
      messageId: 5,
      text: "hi",
    });
    expect(extractIncomingText({ edited_message: { message_id: 6, chat: { id: 42 }, caption: "cap" } })?.text).toBe("cap");
    expect(extractIncomingText({ message: { message_id: 7, chat: { id: 42 } } })).toBeNull();
    expect(extractIncomingText({ update_id: 1 })).toBeNull();
  });

  it("parses the chat allowlist", () => {
    expect([...parseChatAllowlist(" 1, -100200 ,,")]).toEqual(["1", "-100200"]);
    expect(parseChatAllowlist(undefined).size).toBe(0);
  });
});
