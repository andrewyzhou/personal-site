import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parseTrackFile } from "../fit";
import {
  dedupeKey,
  localDateTime,
  computePublished,
  buildActivityValues,
  rowToCalendarActivity,
} from "../activities";
import type { ActivityRow } from "../db/schema";

const fixture = (name: string) =>
  new Uint8Array(fs.readFileSync(path.join(__dirname, "fixtures", name)));

describe("dedupeKey", () => {
  it("is stable and trim-independent (built from pre-trim values)", () => {
    expect(dedupeKey(1751800000, 2400)).toBe(dedupeKey(1751800000, 2400));
    expect(dedupeKey(1751800000, 2400)).not.toBe(dedupeKey(1751800000, 2401));
  });

  it("rounds fractional inputs consistently", () => {
    expect(dedupeKey(1751800000.4, 2400.2)).toBe(dedupeKey(1751800000, 2400));
  });
});

describe("localDateTime", () => {
  it("shifts utc by the offset", () => {
    // 2026-01-05T16:59:58Z at pst (-480) → jan 5, 08:59 local
    const { localDate, localTime } = localDateTime(new Date("2026-01-05T16:59:58Z"), -480);
    expect(localDate).toBe("2026-01-05");
    expect(localTime).toBe("08:59");
  });

  it("crosses date boundaries", () => {
    const { localDate } = localDateTime(new Date("2026-07-03T01:21:57Z"), -420);
    expect(localDate).toBe("2026-07-02");
  });
});

describe("computePublished on a real gps fit", () => {
  const parsed = parseTrackFile(fixture("sample-gps.fit.gz"), "sample-gps.fit.gz");

  it("zero trim uses session totals verbatim", () => {
    const pub = computePublished(parsed, 0, 0);
    expect(pub.stats).toEqual(parsed.sessionStats);
    expect(pub.polyline).toBeTruthy();
    expect(pub.cardPolyline).toBeTruthy();
    expect(pub.bounds).not.toBeNull();
  });

  it("trim reduces published distance and keeps dedupe stable", () => {
    const total = parsed.cumDist[parsed.cumDist.length - 1];
    const pub = computePublished(parsed, 50, 50);
    expect(pub.stats.distanceM).toBeLessThan(total);
    const v0 = buildActivityValues(parsed, computePublished(parsed, 0, 0), { name: "x" });
    const v1 = buildActivityValues(parsed, pub, { name: "x" });
    expect(v0.dedupeKey).toBe(v1.dedupeKey);
    expect(v1.distanceM).toBeLessThan(v0.distanceM!);
  });
});

describe("buildActivityValues + rowToCalendarActivity", () => {
  it("covers every CalendarActivity field round-trip", () => {
    const parsed = parseTrackFile(fixture("sample-gps.fit.gz"), "sample-gps.fit.gz");
    const values = buildActivityValues(parsed, computePublished(parsed, 0, 0), {
      name: "test run",
      description: "notes",
      gear: "shoes",
      source: "upload",
    });

    const row = {
      ...values,
      id: 42,
      hidden: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as ActivityRow;

    const cal = rowToCalendarActivity(row);
    expect(cal.id).toBe(42);
    expect(cal.name).toBe("test run");
    expect(cal.type).toBe(values.sportType);
    expect(cal.date).toBe(values.localDate);
    expect(cal.startTime).toBe(values.localTime);
    expect(cal.distance).toBe(values.distanceM);
    expect(cal.duration).toBe(values.movingTimeS);
    expect(cal.elapsedTime).toBe(values.elapsedTimeS);
    expect(cal.totalElevationGain).toBe(values.elevGainM);
    expect(cal.averageSpeed).toBe(values.avgSpeedMs);
    expect(cal.maxSpeed).toBe(values.maxSpeedMs);
    expect(cal.averageHeartrate).toBe(values.avgHr ?? null);
    expect(cal.maxHeartrate).toBe(values.maxHr ?? null);
    expect(cal.description).toBe("notes");
  });
});
