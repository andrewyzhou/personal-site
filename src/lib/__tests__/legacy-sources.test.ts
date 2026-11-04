import { describe, it, expect } from "vitest";
import { basename, legacyContentType, legacyProvider } from "../legacy-sources";

describe("legacyProvider", () => {
  it("maps every strava-derived source to strava (same as the 0003 backfill)", () => {
    expect(legacyProvider("strava-archive")).toBe("strava");
    expect(legacyProvider("strava-api")).toBe("strava");
    expect(legacyProvider("manual")).toBe("strava");
  });

  it("keeps intervals.icu and falls back to upload", () => {
    expect(legacyProvider("intervals-icu")).toBe("intervals-icu");
    expect(legacyProvider("upload")).toBe("upload");
    expect(legacyProvider("something-new")).toBe("upload");
    expect(legacyProvider(null)).toBe("upload");
    expect(legacyProvider(undefined)).toBe("upload");
  });
});

describe("legacyContentType", () => {
  it("picks a content type by file_type", () => {
    expect(legacyContentType("fit")).toBe("application/octet-stream");
    expect(legacyContentType("gpx")).toBe("application/gpx+xml");
    expect(legacyContentType("tcx")).toBe("application/xml");
    expect(legacyContentType(null)).toBe("application/octet-stream");
  });
});

describe("basename", () => {
  it("returns the last path segment", () => {
    expect(basename("activities/fit/2025/abc.fit")).toBe("abc.fit");
    expect(basename("abc.jpg")).toBe("abc.jpg");
  });
});
