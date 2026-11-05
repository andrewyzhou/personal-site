import { describe, expect, it } from "vitest";
import { planStravaPhotos } from "../strava-photos";

describe("planStravaPhotos", () => {
  it("takes the largest https url, its size, caption, time and location", () => {
    const [p] = planStravaPhotos([
      {
        unique_id: "u1",
        caption: "  game day ",
        created_at: "2026-11-05T08:05:13Z",
        urls: { "600": "https://cdn.example/small.jpg", "5000": "https://cdn.example/big.jpg" },
        sizes: { "600": [600, 450], "5000": [2048, 1536] },
        location: [37.87, -122.25],
      },
    ]);
    expect(p).toEqual({
      uniqueId: "u1",
      url: "https://cdn.example/big.jpg",
      width: 2048,
      height: 1536,
      caption: "game day",
      takenAt: new Date("2026-11-05T08:05:13Z"),
      gps: { lat: 37.87, lng: -122.25 },
    });
  });

  it("skips photos without urls or with non-https urls, and drops 0,0 or missing locations", () => {
    const out = planStravaPhotos([
      { urls: null },
      { urls: { "5000": "http://insecure.example/x.jpg" } },
      { urls: { "5000": "https://cdn.example/a.jpg" }, location: [0, 0], caption: "" },
      { urls: { "5000": "https://cdn.example/b.jpg" }, created_at: "not a date" },
    ]);
    expect(out.map((p) => p.url)).toEqual(["https://cdn.example/a.jpg", "https://cdn.example/b.jpg"]);
    expect(out[0].gps).toBeNull();
    expect(out[0].caption).toBeNull();
    expect(out[1].takenAt).toBeNull();
  });
});
