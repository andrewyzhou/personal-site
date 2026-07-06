import { describe, it, expect, vi, beforeEach } from "vitest";

const getCachedData = vi.fn();

vi.mock("@/lib/cache", () => ({
  getCachedData: (...args: unknown[]) => getCachedData(...args),
}));

vi.mock("@/lib/spotify", () => ({
  getNowPlaying: vi.fn(),
}));

import { GET } from "@/app/api/spotify/route";

beforeEach(() => {
  getCachedData.mockReset();
});

describe("GET /api/spotify", () => {
  it("returns literal null when there is no track (regression: {...null, fetchedAt} was truthy and crashed the client)", async () => {
    getCachedData.mockResolvedValue({
      data: null,
      fetchedAt: 1751800000000,
      previousFetchedAt: null,
    });

    const res = await GET();
    const body = await res.json();

    expect(body).toBeNull();
    expect(res.status).toBe(200);
  });

  it("returns the track with cache metadata when data exists", async () => {
    getCachedData.mockResolvedValue({
      data: { isPlaying: true, title: "song", artist: "artist" },
      fetchedAt: 1751800000000,
      previousFetchedAt: 1751790000000,
      stale: true,
    });

    const res = await GET();
    const body = await res.json();

    expect(body.title).toBe("song");
    expect(body.artist).toBe("artist");
    expect(body.fetchedAt).toBe(1751800000000);
    expect(body.previousFetchedAt).toBe(1751790000000);
    expect(body.stale).toBe(true);
  });

  it("returns 500 with null body when the cache layer throws", async () => {
    getCachedData.mockRejectedValue(new Error("everything is down"));

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toBeNull();
  });
});
