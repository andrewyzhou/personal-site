import { describe, it, expect } from "vitest";
import {
  DEFAULT_LISTENING_TIMEZONE,
  discoveryRate,
  firstHeard,
  genreMix,
  heatmap,
  listeningByDay,
  playsDuringActivities,
  skipRate,
  streaks,
  topAlbums,
  topArtists,
  topTracks,
  totalsBy,
  type StatPlay,
} from "../listening/stats";

function play(at: string, over: Partial<StatPlay> = {}): StatPlay {
  const playedAt = new Date(at);
  const msPlayed = over.msPlayed === undefined ? 180_000 : over.msPlayed;
  return {
    playedAt,
    startedAt: msPlayed === null ? null : new Date(playedAt.getTime() - msPlayed),
    msPlayed,
    skipped: false,
    itemType: "track",
    trackId: "t1",
    trackName: "Song",
    artistIds: ["a1"],
    artistNames: ["Artist"],
    albumId: "al1",
    albumName: "Album",
    genres: ["indie"],
    ...over,
  };
}

const LA = DEFAULT_LISTENING_TIMEZONE;

describe("totalsBy", () => {
  it("buckets by the local date, across dst", () => {
    const rows = totalsBy(
      [play("2026-11-05T06:30:00Z"), play("2026-07-01T06:30:00Z"), play("2026-07-01T07:30:00Z")],
      "day",
      LA
    );
    expect(rows.map((r) => r.period)).toEqual(["2026-06-30", "2026-07-01", "2026-11-04"]);
    expect(totalsBy([play("2026-11-05T06:30:00Z")], "day", "UTC")[0].period).toBe("2026-11-05");
  });

  it("labels iso weeks across the year boundary", () => {
    const rows = totalsBy(
      [
        play("2025-12-29T20:00:00Z"), // mon, 2026-W01
        play("2026-12-31T20:00:00Z"), // thu, 2026-W53
        play("2027-01-03T20:00:00Z"), // sun, still 2026-W53
        play("2027-01-04T20:00:00Z"), // mon, 2027-W01
      ],
      "week",
      LA
    );
    expect(rows.map((r) => [r.period, r.plays])).toEqual([
      ["2026-W01", 1],
      ["2026-W53", 2],
      ["2027-W01", 1],
    ]);
  });

  it("counts null ms as a play with zero time, and does months and years", () => {
    const plays = [play("2026-03-10T20:00:00Z", { msPlayed: null }), play("2026-03-11T20:00:00Z", { msPlayed: 1000 })];
    expect(totalsBy(plays, "month", LA)).toEqual([{ period: "2026-03", plays: 2, msPlayed: 1000 }]);
    expect(totalsBy(plays, "year", LA)).toEqual([{ period: "2026", plays: 2, msPlayed: 1000 }]);
  });
});

describe("top lists", () => {
  const plays = [
    play("2026-01-01T20:00:00Z", { trackId: "t1", trackName: "B", msPlayed: 1000 }),
    play("2026-01-02T20:00:00Z", { trackId: "t1", trackName: "B", msPlayed: 1000 }),
    play("2026-01-03T20:00:00Z", { trackId: "t2", trackName: "A", msPlayed: 5000 }),
    play("2026-01-04T20:00:00Z", { trackId: "t3", trackName: "C", msPlayed: 5000 }),
  ];

  it("ranks by ms or plays with a name tie-break", () => {
    expect(topTracks(plays, { by: "ms" }).map((t) => t.id)).toEqual(["t2", "t3", "t1"]);
    expect(topTracks(plays, { by: "plays", limit: 1 })).toEqual([{ id: "t1", name: "B", plays: 2, msPlayed: 2000 }]);
  });

  it("credits only the primary artist", () => {
    const rows = topArtists([
      play("2026-01-01T20:00:00Z", { artistIds: ["a1", "a2"], artistNames: ["Main", "Guest"] }),
      play("2026-01-02T20:00:00Z", { artistIds: ["a2"], artistNames: ["Guest"] }),
    ]);
    expect(rows.map((r) => [r.id, r.plays])).toEqual([
      ["a2", 1],
      ["a1", 1],
    ]);
  });

  it("falls back to name keys when ids are missing", () => {
    const basic = { trackId: null, artistIds: [], albumId: null };
    const rows = [
      play("2026-01-01T20:00:00Z", { ...basic, trackName: "Song", artistNames: ["Artist"] }),
      play("2026-01-02T20:00:00Z", { ...basic, trackName: "song", artistNames: ["ARTIST"] }),
    ];
    expect(topTracks(rows)).toHaveLength(1);
    expect(topTracks(rows)[0].plays).toBe(2);
    expect(topArtists(rows)[0]).toMatchObject({ id: "name:artist", plays: 2 });
    expect(topAlbums(rows)[0].plays).toBe(2);
  });
});

describe("skipRate", () => {
  it("ignores plays with unknown skip state", () => {
    expect(skipRate([play("2026-01-01T00:00:00Z", { skipped: null })])).toEqual({ known: 0, skipped: 0, rate: null });
    const r = skipRate([
      play("2026-01-01T00:00:00Z", { skipped: true }),
      play("2026-01-01T01:00:00Z", { skipped: false }),
      play("2026-01-01T02:00:00Z", { skipped: null }),
    ]);
    expect(r).toEqual({ known: 2, skipped: 1, rate: 0.5 });
  });
});

describe("heatmap", () => {
  it("is 7x24 indexed by local monday-first weekday and hour", () => {
    const grid = heatmap([play("2026-11-05T06:30:00Z", { msPlayed: 500 })], LA);
    expect(grid).toHaveLength(7);
    expect(grid.every((r) => r.length === 24)).toBe(true);
    // wednesday 22:30 in la
    expect(grid[2][22]).toEqual({ plays: 1, msPlayed: 500 });
    expect(heatmap([play("2026-11-09T08:00:00Z")], LA)[0][0].plays).toBe(1); // mon 00:00
  });
});

describe("streaks", () => {
  const days = (...ds: string[]) => ds.map((d) => play(`${d}T20:00:00Z`));

  it("handles empty input", () => {
    expect(streaks([], LA, "2026-11-04")).toEqual({ current: 0, longest: 0, longestStart: null, longestEnd: null });
  });

  it("finds the longest run and the current one including today", () => {
    const s = streaks(days("2026-10-01", "2026-10-02", "2026-10-03", "2026-11-03", "2026-11-04"), LA, "2026-11-04");
    expect(s).toEqual({ current: 2, longest: 3, longestStart: "2026-10-01", longestEnd: "2026-10-03" });
  });

  it("keeps the current streak alive through yesterday but not two days back", () => {
    const plays = days("2026-11-02", "2026-11-03");
    expect(streaks(plays, LA, "2026-11-04").current).toBe(2);
    expect(streaks(plays, LA, "2026-11-05").current).toBe(0);
  });

  it("crosses month boundaries and uses local days", () => {
    const s = streaks(
      [play("2026-10-31T20:00:00Z"), play("2026-11-02T06:30:00Z")], // second is nov 1 in la
      LA,
      "2026-11-01"
    );
    expect(s).toMatchObject({ current: 2, longest: 2, longestStart: "2026-10-31", longestEnd: "2026-11-01" });
  });
});

describe("firstHeard and discoveryRate", () => {
  const plays = [
    play("2026-02-10T20:00:00Z", { trackId: "t2", artistIds: ["a1", "a2"], artistNames: ["One", "Two"] }),
    play("2026-01-10T20:00:00Z", { trackId: "t1", artistIds: ["a1"], artistNames: ["One"] }),
    play("2026-02-11T20:00:00Z", { trackId: "t1", artistIds: ["a1"], artistNames: ["One"] }),
  ];

  it("returns the earliest play per id regardless of order", () => {
    expect(firstHeard(plays, "track").get("t1")).toEqual(new Date("2026-01-10T20:00:00Z"));
    const artists = firstHeard(plays, "artist");
    expect(artists.get("a1")).toEqual(new Date("2026-01-10T20:00:00Z"));
    expect(artists.get("a2")).toEqual(new Date("2026-02-10T20:00:00Z"));
  });

  it("counts new artists per period", () => {
    expect(discoveryRate(plays, "month", LA)).toEqual([
      { period: "2026-01", artists: 1, newArtists: 1, rate: 1 },
      { period: "2026-02", artists: 2, newArtists: 1, rate: 0.5 },
    ]);
  });
});

describe("genreMix", () => {
  it("keeps top genres, folds the rest into other, and marks unknown", () => {
    const rows = genreMix(
      [
        play("2026-01-10T20:00:00Z", { genres: ["indie", "rock"], msPlayed: 1000 }),
        play("2026-01-11T20:00:00Z", { genres: ["indie"], msPlayed: 1000 }),
        play("2026-01-12T20:00:00Z", { genres: ["jazz"], msPlayed: 100 }),
        play("2026-02-12T20:00:00Z", { genres: [], msPlayed: 300 }),
      ],
      "month",
      LA,
      { top: 2 }
    );
    expect(rows).toEqual([
      { period: "2026-01", msPlayed: 2100, genres: { indie: 1500, rock: 500, other: 100 } },
      { period: "2026-02", msPlayed: 300, genres: { unknown: 300 } },
    ]);
  });
});

describe("listeningByDay", () => {
  it("rounds minutes and picks the top artist by time", () => {
    const rows = listeningByDay(
      [
        play("2026-11-05T06:30:00Z", { msPlayed: 90_000, artistIds: ["a1"], artistNames: ["One"] }),
        play("2026-11-04T20:00:00Z", { msPlayed: 100_000, artistIds: ["a2"], artistNames: ["Two"] }),
        play("2026-11-04T21:00:00Z", { msPlayed: null, artistIds: ["a1"], artistNames: ["One"] }),
      ],
      LA
    );
    expect(rows).toEqual([{ date: "2026-11-04", minutes: 3.2, plays: 3, topArtist: "Two" }]);
  });
});

describe("playsDuringActivities", () => {
  const at = (s: string) => new Date(s);
  // activity 1: 10:00–11:00, activity 2: 11:30–12:00
  const activities = [
    { id: 2, startDateUtc: at("2026-05-01T11:30:00Z"), elapsedTimeS: 1800 },
    { id: 1, startDateUtc: at("2026-05-01T10:00:00Z"), elapsedTimeS: 3600, sportType: "Run" },
    { id: 3, startDateUtc: at("2026-05-02T10:00:00Z"), elapsedTimeS: 600 },
  ];

  it("clips overlap at both ends and splits a play spanning two activities", () => {
    const plays = [
      // starts 5 min before activity 1
      play("2026-05-01T10:02:00Z", { msPlayed: 7 * 60_000, trackId: "t1", trackName: "Early" }),
      // inside activity 1
      play("2026-05-01T10:30:00Z", { msPlayed: 4 * 60_000, trackId: "t2", trackName: "Mid", artistIds: ["b"], artistNames: ["B"] }),
      // runs past the end of activity 1 by 1 min
      play("2026-05-01T11:01:00Z", { msPlayed: 3 * 60_000, trackId: "t3", trackName: "Late" }),
      // 10:50–11:40: spans the end of 1 and the start of 2
      play("2026-05-01T11:40:00Z", { msPlayed: 50 * 60_000, trackId: "t4", trackName: "Long", startedAt: null }),
      // no overlap with anything
      play("2026-05-01T09:00:00Z", { msPlayed: 60_000, trackId: "t5" }),
    ];
    const rows = playsDuringActivities(plays, activities);
    expect(rows.map((r) => r.activityId)).toEqual([1, 2]);

    const [a1, a2] = rows;
    expect(a1.plays).toBe(4);
    expect(a1.overlapMs).toBe((2 + 4 + 2 + 10) * 60_000);
    expect(a1.topArtist).toBe("Artist");
    expect(a1.tracks.map((t) => [t.trackId, t.overlapMs / 60_000])).toEqual([
      ["t4", 10],
      ["t2", 4],
      ["t1", 2],
      ["t3", 2],
    ]);

    expect(a2).toEqual({
      activityId: 2,
      plays: 1,
      overlapMs: 10 * 60_000,
      topArtist: "Artist",
      tracks: [{ trackId: "t4", trackName: "Long", overlapMs: 10 * 60_000 }],
    });
  });

  it("ignores zero-length plays and empty inputs", () => {
    expect(playsDuringActivities([], activities)).toEqual([]);
    expect(playsDuringActivities([play("2026-05-01T10:30:00Z", { msPlayed: null })], activities)).toEqual([]);
  });
});
