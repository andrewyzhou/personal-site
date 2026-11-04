import { describe, it, expect } from "vitest";
import { addDays, localToUtc, safeTimezone, utcToLocal } from "@/lib/lift/time";
import {
  formatIngestSummary,
  formatLocalDay,
  formatVolume,
  formatWatch,
  sportLabel,
  type LinkedActivity,
} from "@/lib/lift/summary";
import { timingFromLinks, type LinkedRecording } from "@/lib/lift/link";
import { bearerMatches, safeEqual } from "@/lib/lift/auth";
import { extractIncomingText, parseChatAllowlist } from "@/lib/lift/telegram";
import type { IngestSummary } from "@/lib/lift/plan";

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
