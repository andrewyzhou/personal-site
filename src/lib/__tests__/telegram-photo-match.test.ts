import { describe, expect, it } from "vitest";
import {
  matchByCaptionDate,
  matchByCaptureTime,
  matchLatest,
  parseCaption,
  type PhotoCandidate,
} from "@/lib/telegram-photo/match";

// pacific daylight time: utc-7
const PDT = -420;

function act(id: number, localDate: string, localTime: string, minutes: number, extra: Partial<PhotoCandidate> = {}): PhotoCandidate {
  const offset = extra.utcOffsetMin ?? PDT;
  const startUtcMs = Date.parse(`${localDate}T${localTime}:00Z`) - offset * 60_000;
  return { id, name: `activity ${id}`, sportType: "Ride", startUtcMs, elapsedS: minutes * 60, utcOffsetMin: offset, localDate, localTime, ...extra };
}

// an instant from a pacific wall clock
const pdt = (local: string) => new Date(Date.parse(`${local}Z`) - PDT * 60_000).toISOString();

describe("parseCaption", () => {
  const today = "2026-11-08";

  it("reads an activity id", () => {
    expect(parseCaption("#512", today)).toEqual({ id: 512, date: null, part: null });
    expect(parseCaption("this goes on #77 please", today).id).toBe(77);
  });

  it("reads month/day as the latest such date, and an explicit year", () => {
    expect(parseCaption("11/4 night", today)).toEqual({ id: null, date: "2026-11-04", part: "night" });
    // december hasn't happened yet this year, so it's last year's
    expect(parseCaption("12/30", today).date).toBe("2025-12-30");
    expect(parseCaption("11/8", today).date).toBe("2026-11-08");
    expect(parseCaption("3/2/25 morning", today)).toEqual({ id: null, date: "2025-03-02", part: "morning" });
    expect(parseCaption("2/30", today).date).toBe(null);
  });

  it("reads month names and relative days", () => {
    expect(parseCaption("Nov 4 evening", today)).toEqual({ id: null, date: "2026-11-04", part: "evening" });
    expect(parseCaption("october 31st", today).date).toBe("2026-10-31");
    expect(parseCaption("yesterday afternoon", today)).toEqual({ id: null, date: "2026-11-07", part: "afternoon" });
    expect(parseCaption("last night", today)).toEqual({ id: null, date: "2026-11-07", part: "night" });
    expect(parseCaption("tonight", today)).toEqual({ id: null, date: "2026-11-08", part: "night" });
    expect(parseCaption("lunch ride today", today)).toEqual({ id: null, date: "2026-11-08", part: "noon" });
  });

  it("ignores captions with nothing to go on", () => {
    expect(parseCaption("nice view", today)).toEqual({ id: null, date: null, part: null });
    expect(parseCaption(null, today)).toEqual({ id: null, date: null, part: null });
    expect(parseCaption("1/2 of the group", today).date).toBe("2026-01-02");
  });
});

describe("matchByCaptureTime", () => {
  const ride = act(1, "2026-11-04", "17:00", 90); // 17:00-18:30
  const lift = act(2, "2026-11-04", "19:30", 60); // 19:30-20:30

  it("takes the activity whose window, with 30 min either side, holds the time", () => {
    expect(matchByCaptureTime({ takenAt: pdt("2026-11-04T17:45:00"), takenAtLocal: null }, [ride, lift])).toEqual({
      activityId: 1,
      by: "photo-time",
      alsoMatched: [],
    });
    expect(matchByCaptureTime({ takenAt: pdt("2026-11-04T16:30:00"), takenAtLocal: null }, [ride])?.activityId).toBe(1);
    expect(matchByCaptureTime({ takenAt: pdt("2026-11-04T16:29:00"), takenAtLocal: null }, [ride])).toBeNull();
    expect(matchByCaptureTime({ takenAt: pdt("2026-11-04T19:00:00"), takenAtLocal: null }, [ride])?.activityId).toBe(1);
    expect(matchByCaptureTime({ takenAt: pdt("2026-11-04T19:01:00"), takenAtLocal: null }, [ride])).toBeNull();
  });

  it("is ambiguous between two windows and picks the closest", () => {
    // 19:05: 35 min after the ride, 25 min before the lift
    const m = matchByCaptureTime({ takenAt: pdt("2026-11-04T19:05:00"), takenAtLocal: null }, [
      { ...ride, elapsedS: 95 * 60 }, // ride now ends 18:35, 30 min before
      lift,
    ]);
    expect(m).toEqual({ activityId: 2, by: "photo-time", alsoMatched: [1] });
    // inside both (a lift recorded inside a ride): the later start is the more specific one
    const inside = matchByCaptureTime({ takenAt: pdt("2026-11-04T18:10:00"), takenAtLocal: null }, [
      ride,
      act(3, "2026-11-04", "18:00", 20),
    ]);
    expect(inside).toEqual({ activityId: 3, by: "photo-time", alsoMatched: [1] });
  });

  it("reads a wall clock without an offset in each activity's own zone", () => {
    const tokyo = act(4, "2026-11-04", "09:00", 60, { utcOffsetMin: 540 });
    expect(matchByCaptureTime({ takenAt: null, takenAtLocal: "2026-11-04T09:20:00" }, [ride, tokyo])?.activityId).toBe(4);
    expect(matchByCaptureTime({ takenAt: null, takenAtLocal: "2026-11-04T17:20:00" }, [ride, tokyo])?.activityId).toBe(1);
    expect(matchByCaptureTime({ takenAt: null, takenAtLocal: null }, [ride])).toBeNull();
  });
});

describe("matchByCaptionDate", () => {
  const morning = act(1, "2026-11-04", "07:10", 40);
  const evening = act(2, "2026-11-04", "18:00", 60);
  const lateNight = act(3, "2026-11-05", "00:30", 30);

  it("prefers the activity inside the named part of the day", () => {
    expect(matchByCaptionDate({ id: null, date: "2026-11-04", part: "morning" }, [morning, evening])).toEqual({
      activityId: 1,
      by: "caption-date",
      alsoMatched: [2],
    });
    expect(matchByCaptionDate({ id: null, date: "2026-11-04", part: "evening" }, [morning, evening])?.activityId).toBe(2);
  });

  it("lets night run past midnight", () => {
    expect(matchByCaptionDate({ id: null, date: "2026-11-04", part: "night" }, [morning, lateNight])?.activityId).toBe(3);
    // without "night" the next day's activity is a different date
    expect(matchByCaptionDate({ id: null, date: "2026-11-04", part: null }, [lateNight])).toBeNull();
  });

  it("with only a date, takes the later activity and reports the other", () => {
    expect(matchByCaptionDate({ id: null, date: "2026-11-04", part: null }, [morning, evening])).toEqual({
      activityId: 2,
      by: "caption-date",
      alsoMatched: [1],
    });
    expect(matchByCaptionDate({ id: null, date: null, part: "night" }, [morning])).toBeNull();
  });
});

describe("matchLatest", () => {
  it("takes the most recent activity that started before the message", () => {
    const a = act(1, "2026-11-04", "07:00", 40);
    const b = act(2, "2026-11-05", "07:00", 40);
    expect(matchLatest(b.startUtcMs + 1, [a, b])).toEqual({ activityId: 2, by: "latest", alsoMatched: [] });
    expect(matchLatest(b.startUtcMs - 1, [a, b])?.activityId).toBe(1);
    expect(matchLatest(0, [a, b])).toBeNull();
  });
});
