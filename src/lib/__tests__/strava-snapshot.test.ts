import { describe, it, expect } from "vitest";
import {
  SNAPSHOT_KINDS,
  buildPlan,
  collectStravaTargets,
  emptyCheckpoint,
  idsFromCsvRows,
  markCheckpoint,
  pairKey,
  parseCheckpoint,
  snapshotEndpoint,
  storedPairs,
} from "../strava-snapshot";

describe("snapshotEndpoint", () => {
  it("builds the four endpoints", () => {
    expect(snapshotEndpoint("strava-detail", "123")).toBe("/activities/123?include_all_efforts=true");
    expect(snapshotEndpoint("strava-streams", "123")).toBe(
      "/activities/123/streams?keys=time,latlng,altitude,distance,heartrate,cadence,watts,velocity_smooth,temp,moving,grade_smooth&key_by_type=true"
    );
    expect(snapshotEndpoint("strava-laps", "123")).toBe("/activities/123/laps");
    expect(snapshotEndpoint("strava-photos", "123")).toBe("/activities/123/photos?size=5000&photo_sources=true");
  });
});

describe("collectStravaTargets", () => {
  it("unions sources and legacy rows, filtering by legacy source", () => {
    const r = collectStravaTargets({
      sources: [
        { activityId: 1, externalId: "900" },
        { activityId: 2, externalId: "12345678901" },
      ],
      legacy: [
        { id: 1, externalId: "900", source: "strava-archive" },
        { id: 3, externalId: "77", source: "manual" },
        { id: 4, externalId: "88", source: "strava-api" },
        { id: 5, externalId: "i123", source: "intervals-icu" },
        { id: 6, externalId: null, source: "upload" },
      ],
    });
    expect(r.targets).toEqual([
      { stravaId: "77", activityId: 3 },
      { stravaId: "88", activityId: 4 },
      { stravaId: "900", activityId: 1 },
      { stravaId: "12345678901", activityId: 2 },
    ]);
    expect(r.conflicts).toEqual([]);
  });

  it("reports csv ids without an activity and ignores junk", () => {
    const r = collectStravaTargets({
      sources: [],
      legacy: [{ id: 1, externalId: "10", source: "strava-archive" }],
      csvIds: ["10", "11", " 11 ", "abc", ""],
    });
    expect(r.targets).toEqual([{ stravaId: "10", activityId: 1 }]);
    expect(r.unmatched).toEqual(["11"]);
  });

  it("reports a strava id linked to several activities, keeping the lowest", () => {
    const r = collectStravaTargets({
      sources: [{ activityId: 9, externalId: "5" }],
      legacy: [{ id: 4, externalId: "5", source: "strava-api" }],
    });
    expect(r.targets).toEqual([{ stravaId: "5", activityId: 4 }]);
    expect(r.conflicts).toEqual([{ stravaId: "5", activityIds: [4, 9] }]);
  });
});

describe("buildPlan", () => {
  const targets = [
    { stravaId: "1", activityId: 10 },
    { stravaId: "2", activityId: 20 },
  ];

  it("plans every kind, kind-major", () => {
    const p = buildPlan(targets);
    expect(p.requests).toHaveLength(8);
    expect(p.requests.map((r) => pairKey(r.stravaId, r.kind))).toEqual([
      "1:strava-detail", "2:strava-detail",
      "1:strava-streams", "2:strava-streams",
      "1:strava-laps", "2:strava-laps",
      "1:strava-photos", "2:strava-photos",
    ]);
    expect(p.requests[0]).toEqual({ stravaId: "1", activityId: 10, kind: "strava-detail", path: "/activities/1?include_all_efforts=true" });
  });

  it("skips stored pairs and checkpointed done/gone pairs", () => {
    const stored = storedPairs([
      { externalId: "1", kind: "strava-detail", rawSha256: "a".repeat(64) },
      { externalId: "2", kind: "strava-streams", rawSha256: null }, // no raw: not done
      { externalId: "2", kind: "device-file", rawSha256: "b".repeat(64) }, // not a snapshot kind
    ]);
    let cp = markCheckpoint(emptyCheckpoint(), "2:strava-detail", "done");
    cp = markCheckpoint(cp, "1:strava-photos", "gone");
    const p = buildPlan(targets, { stored, checkpoint: cp });
    expect(p.skippedStored).toBe(1);
    expect(p.skippedCheckpoint).toBe(2);
    expect(p.requests.map((r) => pairKey(r.stravaId, r.kind))).not.toContain("1:strava-detail");
    expect(p.requests).toHaveLength(5);
    expect(buildPlan(targets, { stored, checkpoint: cp, retryGone: true }).requests).toHaveLength(6);
  });

  it("restricts kinds", () => {
    const p = buildPlan(targets, { kinds: ["strava-streams"] });
    expect(p.requests.every((r) => r.kind === "strava-streams")).toBe(true);
    expect(p.requests).toHaveLength(2);
  });

  it("covers all four kinds", () => {
    expect(SNAPSHOT_KINDS).toEqual(["strava-detail", "strava-streams", "strava-laps", "strava-photos"]);
  });
});

describe("checkpoint", () => {
  it("round-trips and ignores duplicates", () => {
    const now = new Date("2026-11-04T00:00:00Z");
    let cp = markCheckpoint(emptyCheckpoint(), "1:strava-detail", "done", now);
    cp = markCheckpoint(cp, "1:strava-detail", "done", now);
    cp = markCheckpoint(cp, "2:strava-laps", "gone", now);
    const back = parseCheckpoint(JSON.stringify(cp));
    expect(back).toEqual({ version: 1, done: ["1:strava-detail"], gone: ["2:strava-laps"], updatedAt: now.toISOString() });
  });

  it("falls back to empty on missing or corrupt files", () => {
    expect(parseCheckpoint(null)).toEqual(emptyCheckpoint());
    expect(parseCheckpoint("{not json")).toEqual(emptyCheckpoint());
    expect(parseCheckpoint(JSON.stringify({ version: 2, done: ["x"] }))).toEqual(emptyCheckpoint());
    expect(parseCheckpoint(JSON.stringify({ version: 1, done: ["x", 3] })).done).toEqual(["x"]);
  });
});

describe("idsFromCsvRows", () => {
  it("reads the Activity ID column", () => {
    expect(idsFromCsvRows([{ "Activity ID": "123" }, { "Activity ID": " 456 " }, { "Activity ID": "" }, {}])).toEqual(["123", "456"]);
  });
});
