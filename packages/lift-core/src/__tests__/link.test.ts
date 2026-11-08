import { describe, expect, it } from "vitest";
import { linkWorkoutToActivities, STRENGTH_SPORT_TYPES } from "../link";
import type { LinkCandidate } from "../types";

function c(id: number, localStart: string, elapsedS: number, sportType = "WeightTraining"): LinkCandidate {
  return { id, sportType, localStart, elapsedS };
}

describe("linkWorkoutToActivities", () => {
  it("exposes the strength sport types", () => {
    expect(STRENGTH_SPORT_TYPES).toEqual(["WeightTraining", "Workout"]);
  });

  it("2026-10-18: links the 18:10 recording as primary and the 17:45 warm-up as continuation", () => {
    const candidates = [c(2, "2026-10-18T18:10", 4286), c(1, "2026-10-18T17:45", 926, "Workout")];
    expect(linkWorkoutToActivities("2026-10-18T18:08", candidates)).toEqual([
      { activityId: 1, role: "continuation", deltaMin: -23 },
      { activityId: 2, role: "primary", deltaMin: 2 },
    ]);
  });

  it("2026-11-02: a forgot-to-stop 6h recording is still the primary", () => {
    expect(linkWorkoutToActivities("2026-11-02T14:05", [c(9, "2026-11-02T14:01", 21909)])).toEqual([
      { activityId: 9, role: "primary", deltaMin: -4 },
    ]);
  });

  it("2026-11-02 (real): share at 19:18 inside activity 496 (14:01, 365 min) links as overrun", () => {
    const candidates = [c(496, "2026-11-02T14:01", 21909), c(497, "2026-11-02T19:10", 1800, "Ride")];
    expect(linkWorkoutToActivities("2026-11-02T19:18", candidates)).toEqual([
      { activityId: 496, role: "overrun", deltaMin: -317 },
    ]);
  });

  it("prefers a start-window primary over a long container", () => {
    const candidates = [c(496, "2026-11-02T14:01", 21909), c(498, "2026-11-02T19:20", 3600)];
    expect(linkWorkoutToActivities("2026-11-02T19:18", candidates)).toEqual([
      { activityId: 496, role: "duplicate", deltaMin: -317 },
      { activityId: 498, role: "primary", deltaMin: 2 },
    ]);
  });

  it("picks the latest-starting container and ignores recordings that ended before the start", () => {
    const candidates = [
      c(1, "2026-11-02T10:00", 12 * 3600),
      c(2, "2026-11-02T14:01", 21909),
      c(3, "2026-11-02T12:00", 3600),
    ];
    expect(linkWorkoutToActivities("2026-11-02T19:18", candidates)).toEqual([
      { activityId: 2, role: "overrun", deltaMin: -317 },
    ]);
    // recording ended at 20:06, so a 20:30 workout is not inside it
    expect(linkWorkoutToActivities("2026-11-02T20:30", [c(2, "2026-11-02T14:01", 21909)])).toEqual([]);
  });

  it("prefers a strength recording over any other sport", () => {
    const mixed = linkWorkoutToActivities("2026-11-02T14:05", [
      c(1, "2026-11-02T14:05", 3600, "Ride"),
      c(2, "2026-11-02T14:15", 3600),
    ]);
    expect(mixed).toEqual([{ activityId: 2, role: "primary", deltaMin: 10 }]);
    // even a strength recording the lift started well into beats a ride starting right then
    const container = linkWorkoutToActivities("2026-11-02T14:05", [
      c(1, "2026-11-02T14:05", 3600, "Ride"),
      c(2, "2026-11-02T13:00", 3 * 3600),
    ]);
    expect(container).toEqual([{ activityId: 2, role: "overrun", deltaMin: -65 }]);
  });

  it("bike + lift: a lift inside a ride belongs to the ride", () => {
    // ride 17:00-18:40, lift shared as starting 18:05
    expect(linkWorkoutToActivities("2026-11-04T18:05", [c(7, "2026-11-04T17:00", 6000, "Ride")])).toEqual([
      { activityId: 7, role: "overrun", deltaMin: -65 },
    ]);
    // a lift that starts with the recording takes its timing (primary)
    expect(linkWorkoutToActivities("2026-11-04T17:05", [c(7, "2026-11-04T17:00", 6000, "Ride")])).toEqual([
      { activityId: 7, role: "primary", deltaMin: -5 },
    ]);
  });

  it("matches any sport from 30 min before its start to its end", () => {
    const run = (start: string) => linkWorkoutToActivities(start, [c(3, "2026-11-04T18:00", 3600, "Run")]);
    expect(run("2026-11-04T17:29")).toEqual([]);
    expect(run("2026-11-04T17:30")).toEqual([{ activityId: 3, role: "primary", deltaMin: 30 }]);
    expect(run("2026-11-04T18:20")).toEqual([{ activityId: 3, role: "primary", deltaMin: -20 }]);
    expect(run("2026-11-04T18:21")).toEqual([{ activityId: 3, role: "overrun", deltaMin: -21 }]);
    expect(run("2026-11-04T19:00")).toEqual([{ activityId: 3, role: "overrun", deltaMin: -60 }]);
    expect(run("2026-11-04T19:01")).toEqual([]);
  });

  it("among other sports, the latest-starting recording that contains the lift wins", () => {
    const out = linkWorkoutToActivities("2026-11-04T12:00", [
      c(1, "2026-11-04T09:00", 5 * 3600, "Hike"),
      c(2, "2026-11-04T11:00", 2 * 3600, "Walk"),
    ]);
    expect(out).toEqual([{ activityId: 2, role: "overrun", deltaMin: -60 }]);
  });

  it("other sports never attach as duplicates or continuations", () => {
    const out = linkWorkoutToActivities("2026-11-04T18:00", [
      c(1, "2026-11-04T18:00", 3600),
      c(2, "2026-11-04T18:05", 1800, "Run"),
      c(3, "2026-11-04T19:05", 1800, "Run"),
    ]);
    expect(out).toEqual([{ activityId: 1, role: "primary", deltaMin: 0 }]);
  });

  it("a recording that ended before the lift started doesn't match", () => {
    expect(linkWorkoutToActivities("2026-11-04T18:08", [c(1, "2026-11-04T17:45", 926, "Workout")])).toEqual([]);
  });

  it("returns nothing when no recording is within reach", () => {
    expect(linkWorkoutToActivities("2026-11-02T14:05", [c(1, "2026-11-02T14:40", 3600)])).toEqual([]);
    expect(linkWorkoutToActivities("2026-11-02T14:05", [])).toEqual([]);
  });

  it("respects a custom lead", () => {
    expect(linkWorkoutToActivities("2026-11-02T14:05", [c(1, "2026-11-02T14:40", 3600)], { leadMin: 40 })).toEqual([
      { activityId: 1, role: "primary", deltaMin: 35 },
    ]);
  });

  it("marks an overlapping second device as a duplicate", () => {
    const out = linkWorkoutToActivities("2026-11-04T18:12", [
      c(1, "2026-11-04T18:10", 3600),
      c(2, "2026-11-04T18:14", 3500),
    ]);
    expect(out).toEqual([
      { activityId: 1, role: "primary", deltaMin: -2 },
      { activityId: 2, role: "duplicate", deltaMin: 2 },
    ]);
  });

  it("breaks a primary tie toward the earlier start", () => {
    const out = linkWorkoutToActivities("2026-11-04T18:12", [
      c(2, "2026-11-04T18:17", 3600),
      c(1, "2026-11-04T18:07", 3600),
    ]);
    expect(out.find((l) => l.role === "primary")?.activityId).toBe(1);
    expect(out.find((l) => l.activityId === 2)?.role).toBe("duplicate");
  });

  it("chains split recordings as continuations", () => {
    const out = linkWorkoutToActivities("2026-11-04T18:00", [
      c(1, "2026-11-04T18:01", 1800),
      // starts 10 min after #1 ends
      c(2, "2026-11-04T18:41", 1200),
      // starts 14 min after #2 ends
      c(3, "2026-11-04T19:15", 600),
      // starts 30 min after #3 ends: too far
      c(4, "2026-11-04T19:55", 600),
    ]);
    expect(out).toEqual([
      { activityId: 1, role: "primary", deltaMin: 1 },
      { activityId: 2, role: "continuation", deltaMin: 41 },
      { activityId: 3, role: "continuation", deltaMin: 75 },
    ]);
  });

  it("respects a custom continuation gap", () => {
    const out = linkWorkoutToActivities(
      "2026-11-04T18:00",
      [c(1, "2026-11-04T18:00", 1800), c(2, "2026-11-04T18:50", 600)],
      { continuationGapMin: 25 },
    );
    expect(out.map((l) => l.role)).toEqual(["primary", "continuation"]);
  });

  it("stops chaining 4h after the workout start", () => {
    const out = linkWorkoutToActivities("2026-11-04T10:00", [
      c(1, "2026-11-04T10:00", 3.9 * 3600),
      c(2, "2026-11-04T14:05", 600),
    ]);
    expect(out.map((l) => l.activityId)).toEqual([1]);
  });

  it("handles midnight crossings", () => {
    const out = linkWorkoutToActivities("2026-12-31T23:55", [
      c(1, "2027-01-01T00:05", 3600),
      c(2, "2027-01-01T01:15", 900, "Workout"),
    ]);
    expect(out).toEqual([
      { activityId: 1, role: "primary", deltaMin: 10 },
      { activityId: 2, role: "continuation", deltaMin: 80 },
    ]);
    expect(linkWorkoutToActivities("2026-11-05T00:05", [c(3, "2026-11-04T23:55", 3600)])).toEqual([
      { activityId: 3, role: "primary", deltaMin: -10 },
    ]);
  });

  it("never mutates its input and returns results sorted by start", () => {
    const candidates = Object.freeze([
      Object.freeze(c(3, "2026-10-18T18:10", 4286)),
      Object.freeze(c(1, "2026-10-18T17:45", 926, "Workout")),
    ]);
    const before = JSON.stringify(candidates);
    const out = linkWorkoutToActivities("2026-10-18T18:08", candidates);
    expect(JSON.stringify(candidates)).toBe(before);
    expect(out.map((l) => l.activityId)).toEqual([1, 3]);
  });

  it("returns nothing for an unparseable workout start and skips bad candidates", () => {
    expect(linkWorkoutToActivities("not a date", [c(1, "2026-11-04T18:00", 60)])).toEqual([]);
    expect(
      linkWorkoutToActivities("2026-11-04T18:00", [c(1, "garbage", 60), c(2, "2026-11-04T18:03", 60)]),
    ).toEqual([{ activityId: 2, role: "primary", deltaMin: 3 }]);
  });
});
