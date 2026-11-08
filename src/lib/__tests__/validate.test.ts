import { describe, it, expect } from "vitest";
import { isSpotifyTrack, isLatestActivity, isLiteralBook, isStatsPayload } from "../validate";

describe("isSpotifyTrack", () => {
  it("accepts a valid track", () => {
    expect(
      isSpotifyTrack({ isPlaying: true, title: "song", artist: "artist" })
    ).toBe(true);
  });

  it("rejects the {fetchedAt}-only object that crashed Currently (regression)", () => {
    // /api/spotify used to spread null into {...null, fetchedAt} producing this shape
    expect(isSpotifyTrack({ fetchedAt: 1751800000000, previousFetchedAt: null })).toBe(false);
  });

  it("rejects null, undefined, and primitives", () => {
    expect(isSpotifyTrack(null)).toBe(false);
    expect(isSpotifyTrack(undefined)).toBe(false);
    expect(isSpotifyTrack("song")).toBe(false);
  });

  it("rejects a track missing artist", () => {
    expect(isSpotifyTrack({ title: "song" })).toBe(false);
  });
});

describe("isLatestActivity", () => {
  const valid = {
    id: 123,
    name: "morning run",
    type: "Run",
    startDate: "2026-07-01T07:00:00Z",
    formattedDistance: "5.0 mi",
    formattedDuration: "40 min",
  };

  it("accepts a valid activity", () => {
    expect(isLatestActivity(valid)).toBe(true);
  });

  it("rejects when formatted metrics are missing", () => {
    expect(isLatestActivity({ ...valid, formattedDistance: undefined })).toBe(false);
    expect(isLatestActivity({ ...valid, formattedDuration: undefined })).toBe(false);
  });

  it("rejects the metadata-only failure shape", () => {
    expect(isLatestActivity({ fetchedAt: 1751800000000 })).toBe(false);
  });
});

describe("isLiteralBook", () => {
  it("accepts a book with a title (authors optional)", () => {
    expect(isLiteralBook({ title: "some book" })).toBe(true);
    expect(isLiteralBook({ title: "some book", authors: [{ id: "1", name: "a" }] })).toBe(true);
  });

  it("rejects objects without a title", () => {
    expect(isLiteralBook({ authors: [] })).toBe(false);
    expect(isLiteralBook(null)).toBe(false);
  });
});

describe("isStatsPayload", () => {
  it("accepts valid counters", () => {
    expect(isStatsPayload({ prevCount: 1, apiCalls: 2 })).toBe(true);
  });

  it("rejects missing or non-numeric counters", () => {
    expect(isStatsPayload({ prevCount: "1", apiCalls: 2 })).toBe(false);
    expect(isStatsPayload({})).toBe(false);
    expect(isStatsPayload(null)).toBe(false);
  });
});
