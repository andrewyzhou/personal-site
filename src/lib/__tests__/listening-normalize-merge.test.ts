import { describe, it, expect } from "vitest";
import {
  itemKey,
  nameKey,
  playFromApiItem,
  playFromBasic,
  playFromExtended,
  type ApiRecentItem,
} from "@/lib/listening/normalize";
import {
  BASIC_MATCH_TOLERANCE_MS,
  EXTENDED_MATCH_TOLERANCE_MS,
  apiPatchForExportRow,
  estimateMsPlayed,
  exportPatchForApiRow,
  matchPlays,
  type ExistingPlay,
} from "@/lib/listening/merge";

const T = (s: string) => new Date(s);

function apiItem(over: Partial<ApiRecentItem> = {}): ApiRecentItem {
  return {
    track: {
      id: "trk1",
      uri: "spotify:track:trk1",
      name: "Song One",
      type: "track",
      duration_ms: 200_000,
      album: { id: "alb1", name: "Album One" },
      artists: [
        { id: "art1", name: "Artist One" },
        { id: "art2", name: "Artist Two" },
      ],
    },
    played_at: "2024-03-01T12:00:00.250Z",
    context: { type: "playlist", uri: "spotify:playlist:pl1" },
    ...over,
  };
}

function ext(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ts: "2024-03-01T12:00:00Z",
    platform: "ios",
    ms_played: 180_000,
    conn_country: "US",
    master_metadata_track_name: "Song One",
    master_metadata_album_artist_name: "Artist One",
    master_metadata_album_album_name: "Album One",
    spotify_track_uri: "spotify:track:trk1",
    episode_name: null,
    episode_show_name: null,
    spotify_episode_uri: null,
    reason_start: "trackdone",
    reason_end: "endplay",
    shuffle: true,
    skipped: false,
    offline: false,
    offline_timestamp: 1709294400,
    incognito_mode: false,
    ...over,
  };
}

function existing(id: number, over: Partial<ExistingPlay> = {}): ExistingPlay {
  return {
    id,
    playedAt: T("2024-03-01T12:00:00Z"),
    source: "api-recent",
    trackUri: null,
    episodeUri: null,
    trackName: null,
    artistName: null,
    episodeName: null,
    showName: null,
    apiDedupeKey: null,
    exportDedupeKey: null,
    msPlayed: null,
    msPlayedEstimated: false,
    ...over,
  };
}

describe("playFromApiItem", () => {
  it("maps a track with its context and raw link", () => {
    const d = playFromApiItem(apiItem(), "sha", 3)!;
    expect(d.source).toBe("api-recent");
    expect(d.itemType).toBe("track");
    expect(d.playedAt.toISOString()).toBe("2024-03-01T12:00:00.250Z");
    expect(d.trackUri).toBe("spotify:track:trk1");
    expect(d.trackId).toBe("trk1");
    expect(d.trackName).toBe("Song One");
    expect(d.artistName).toBe("Artist One");
    expect(d.albumName).toBe("Album One");
    expect(d.contextType).toBe("playlist");
    expect(d.contextUri).toBe("spotify:playlist:pl1");
    expect(d.apiRawSha256).toBe("sha");
    expect(d.apiRawIndex).toBe(3);
    expect(d.apiDedupeKey).toBe("api:spotify:track:trk1@2024-03-01T12:00:00.250Z");
    expect(d.msPlayed).toBeNull();
    expect(d.startedAt).toBeNull();
    expect(d.exportDedupeKey).toBeNull();
  });

  it("falls back to the uri for a missing track id", () => {
    const item = apiItem();
    item.track!.id = null;
    expect(playFromApiItem(item, null, 0)!.trackId).toBe("trk1");
  });

  it("maps an episode", () => {
    const d = playFromApiItem(
      apiItem({
        track: { id: "ep1", uri: "spotify:episode:ep1", name: "Ep One", type: "episode", show: { name: "Show One" } },
        context: null,
      }),
      null,
      0
    )!;
    expect(d.itemType).toBe("episode");
    expect(d.episodeUri).toBe("spotify:episode:ep1");
    expect(d.episodeName).toBe("Ep One");
    expect(d.showName).toBe("Show One");
    expect(d.trackUri).toBeNull();
    expect(d.trackId).toBeNull();
    expect(d.contextType).toBeNull();
  });

  it("drops a null track or a bad date", () => {
    expect(playFromApiItem(apiItem({ track: null }), null, 0)).toBeNull();
    expect(playFromApiItem(apiItem({ played_at: "not a date" }), null, 0)).toBeNull();
  });
});

describe("playFromExtended", () => {
  it("maps a track with exact fields and started_at = ts - ms", () => {
    const d = playFromExtended(ext(), "fsha", 7)!;
    expect(d.source).toBe("export-extended");
    expect(d.itemType).toBe("track");
    expect(d.trackId).toBe("trk1");
    expect(d.artistName).toBe("Artist One");
    expect(d.msPlayed).toBe(180_000);
    expect(d.startedAt!.toISOString()).toBe("2024-03-01T11:57:00.000Z");
    expect(d.shuffle).toBe(true);
    expect(d.skipped).toBe(false);
    expect(d.offline).toBe(false);
    expect(d.incognito).toBe(false);
    expect(d.offlineTimestamp).toBe(1709294400);
    expect(d.platform).toBe("ios");
    expect(d.country).toBe("US");
    expect(d.reasonStart).toBe("trackdone");
    expect(d.reasonEnd).toBe("endplay");
    expect(d.exportRawSha256).toBe("fsha");
    expect(d.exportRawIndex).toBe(7);
    expect(d.apiDedupeKey).toBeNull();
    expect(d.exportDedupeKey).toBe("ext:spotify:track:trk1@2024-03-01T12:00:00.000Z:180000");
  });

  it("dedupe key is stable and independent of the raw link", () => {
    const a = playFromExtended(ext(), "a", 0)!;
    const b = playFromExtended(ext(), "b", 9)!;
    expect(a.exportDedupeKey).toBe(b.exportDedupeKey);
    expect(playFromExtended(ext({ ms_played: 1 }), "a", 0)!.exportDedupeKey).not.toBe(a.exportDedupeKey);
  });

  it("maps episodes, audiobooks and unknown items", () => {
    const ep = playFromExtended(
      ext({
        spotify_track_uri: null,
        master_metadata_track_name: null,
        master_metadata_album_artist_name: null,
        master_metadata_album_album_name: null,
        spotify_episode_uri: "spotify:episode:ep1",
        episode_name: "Ep One",
        episode_show_name: "Show One",
      }),
      null,
      0
    )!;
    expect(ep.itemType).toBe("episode");
    expect(ep.episodeUri).toBe("spotify:episode:ep1");
    expect(ep.showName).toBe("Show One");
    expect(ep.exportDedupeKey).toBe("ext:spotify:episode:ep1@2024-03-01T12:00:00.000Z:180000");

    const book = playFromExtended(
      ext({
        spotify_track_uri: null,
        master_metadata_track_name: null,
        master_metadata_album_artist_name: null,
        audiobook_title: "Book",
        audiobook_uri: "spotify:audiobook:bk1",
        audiobook_chapter_uri: "spotify:chapter:ch1",
        audiobook_chapter_title: "Chapter 1",
      }),
      null,
      0
    )!;
    expect(book.itemType).toBe("audiobook");
    expect(book.audiobookTitle).toBe("Book");
    expect(book.audiobookChapterTitle).toBe("Chapter 1");
    // chapter uri wins over the book uri for the item key
    expect(itemKey(book)).toBe("spotify:chapter:ch1");

    const unknown = playFromExtended(
      ext({ spotify_track_uri: null, master_metadata_track_name: null, master_metadata_album_artist_name: null }),
      null,
      0
    )!;
    expect(unknown.itemType).toBe("unknown");
    expect(unknown.exportDedupeKey).toBe("ext:name:|@2024-03-01T12:00:00.000Z:180000");
  });

  it("reads 1/0 as booleans and ignores other values", () => {
    const d = playFromExtended(ext({ shuffle: 1, skipped: 0, offline: "true", incognito_mode: null }), null, 0)!;
    expect(d.shuffle).toBe(true);
    expect(d.skipped).toBe(false);
    expect(d.offline).toBeNull();
    expect(d.incognito).toBeNull();
  });

  it("rounds ms and drops rows without ts or ms_played", () => {
    expect(playFromExtended(ext({ ms_played: 1000.6 }), null, 0)!.msPlayed).toBe(1001);
    expect(playFromExtended(ext({ ts: undefined }), null, 0)).toBeNull();
    expect(playFromExtended(ext({ ts: "garbage" }), null, 0)).toBeNull();
    expect(playFromExtended(ext({ ms_played: "100" }), null, 0)).toBeNull();
  });
});

describe("playFromBasic", () => {
  it("maps music with endTime parsed as utc", () => {
    const d = playFromBasic(
      { endTime: "2024-03-01 12:05", artistName: "Artist One", trackName: "Song One", msPlayed: 60_000 },
      "bsha",
      2
    )!;
    expect(d.source).toBe("export-basic");
    expect(d.itemType).toBe("track");
    expect(d.playedAt.toISOString()).toBe("2024-03-01T12:05:00.000Z");
    expect(d.startedAt!.toISOString()).toBe("2024-03-01T12:04:00.000Z");
    expect(d.trackUri).toBeNull();
    expect(d.exportRawIndex).toBe(2);
    expect(d.exportDedupeKey).toBe("basic:name:artist one|song one@2024-03-01T12:05:00.000Z:60000");
  });

  it("maps podcasts", () => {
    const d = playFromBasic(
      { endTime: "2024-03-01 12:05", podcastName: "Show One", episodeName: "Ep One", msPlayed: 1000 },
      null,
      0
    )!;
    expect(d.itemType).toBe("episode");
    expect(d.showName).toBe("Show One");
    expect(d.episodeName).toBe("Ep One");
    expect(d.artistName).toBeNull();
  });

  it("drops bad end times", () => {
    expect(playFromBasic({ endTime: "yesterday", msPlayed: 1 }, null, 0)).toBeNull();
    expect(playFromBasic({ endTime: "2024-03-01 12:05" }, null, 0)).toBeNull();
  });
});

describe("itemKey / nameKey", () => {
  it("prefers the uri, else normalized names", () => {
    expect(itemKey({ trackUri: "spotify:track:x", trackName: "A" })).toBe("spotify:track:x");
    expect(itemKey({ episodeUri: "spotify:episode:e" })).toBe("spotify:episode:e");
    expect(itemKey({ trackName: "  Song   One ", artistName: "ARTIST one" })).toBe("name:artist one|song one");
    expect(nameKey({ showName: "Show", episodeName: "Ep" })).toBe("name:show|ep");
    expect(nameKey({ trackName: "S", artistName: "A" })).toBe("name:a|s");
  });
});

describe("matchPlays", () => {
  const api = (playedAt: string) => playFromApiItem(apiItem({ played_at: playedAt }), null, 0)!;
  const extAt = (ts: string) => playFromExtended(ext({ ts }), null, 0)!;
  const uriRow = (id: number, at: string, over: Partial<ExistingPlay> = {}) =>
    existing(id, { playedAt: T(at), trackUri: "spotify:track:trk1", trackName: "Song One", artistName: "Artist One", ...over });

  it("matches at exactly the tolerance, not past it", () => {
    const rows = [uriRow(1, "2024-03-01T12:00:00Z")];
    expect(matchPlays(rows, [extAt("2024-03-01T12:00:15Z")], { kind: "export", toleranceMs: EXTENDED_MATCH_TOLERANCE_MS })).toEqual([
      { existingId: 1, incomingIndex: 0, deltaMs: 15_000 },
    ]);
    expect(matchPlays(rows, [extAt("2024-03-01T12:00:16Z")], { kind: "export", toleranceMs: EXTENDED_MATCH_TOLERANCE_MS })).toEqual([]);
  });

  it("pairs one-to-one, closest first", () => {
    const rows = [uriRow(1, "2024-03-01T12:00:00Z"), uriRow(2, "2024-03-01T12:00:10Z")];
    // x at +8s (closest to row 2), y at +1s (closest to row 1)
    const m = matchPlays(rows, [extAt("2024-03-01T12:00:08Z"), extAt("2024-03-01T12:00:01Z")], {
      kind: "export",
      toleranceMs: EXTENDED_MATCH_TOLERANCE_MS,
    });
    expect(m).toEqual([
      { existingId: 2, incomingIndex: 0, deltaMs: 2000 },
      { existingId: 1, incomingIndex: 1, deltaMs: 1000 },
    ]);
    // two incoming, one row: only the closer one gets it
    const one = matchPlays([uriRow(1, "2024-03-01T12:00:00Z")], [extAt("2024-03-01T12:00:05Z"), extAt("2024-03-01T12:00:02Z")], {
      kind: "export",
      toleranceMs: EXTENDED_MATCH_TOLERANCE_MS,
    });
    expect(one).toEqual([{ existingId: 1, incomingIndex: 1, deltaMs: 2000 }]);
  });

  it("skips rows already carrying the incoming kind's key", () => {
    const rows = [uriRow(1, "2024-03-01T12:00:00Z", { exportDedupeKey: "ext:x" })];
    expect(matchPlays(rows, [extAt("2024-03-01T12:00:00Z")], { kind: "export", toleranceMs: 15_000 })).toEqual([]);
    const apiRows = [uriRow(1, "2024-03-01T12:00:00Z", { apiDedupeKey: "api:x" })];
    expect(matchPlays(apiRows, [api("2024-03-01T12:00:00Z")], { kind: "api", toleranceMs: 15_000 })).toEqual([]);
    // the other kind's key doesn't block
    expect(matchPlays(apiRows, [extAt("2024-03-01T12:00:00Z")], { kind: "export", toleranceMs: 15_000 })).toHaveLength(1);
  });

  it("never matches a different uri", () => {
    const rows = [uriRow(1, "2024-03-01T12:00:00Z", { trackUri: "spotify:track:other" })];
    expect(matchPlays(rows, [extAt("2024-03-01T12:00:00Z")], { kind: "export", toleranceMs: 15_000 })).toEqual([]);
  });

  it("matches a name-only basic play onto a row by names", () => {
    const rows = [uriRow(1, "2024-03-01T12:00:40Z")];
    const basic = playFromBasic({ endTime: "2024-03-01 12:00", artistName: "artist one", trackName: "SONG ONE", msPlayed: 1 }, null, 0)!;
    expect(matchPlays(rows, [basic], { kind: "export", toleranceMs: BASIC_MATCH_TOLERANCE_MS })).toEqual([
      { existingId: 1, incomingIndex: 0, deltaMs: 40_000 },
    ]);
    const other = playFromBasic({ endTime: "2024-03-01 12:00", artistName: "artist one", trackName: "else", msPlayed: 1 }, null, 0)!;
    expect(matchPlays(rows, [other], { kind: "export", toleranceMs: BASIC_MATCH_TOLERANCE_MS })).toEqual([]);
  });

  it("matches an api play onto a uri-less basic row by names", () => {
    const rows = [existing(1, { source: "export-basic", playedAt: T("2024-03-01T12:00:00Z"), trackName: "Song One", artistName: "Artist One", exportDedupeKey: "basic:x" })];
    expect(matchPlays(rows, [api("2024-03-01T12:00:40Z")], { kind: "api", toleranceMs: BASIC_MATCH_TOLERANCE_MS })).toEqual([
      { existingId: 1, incomingIndex: 0, deltaMs: 40_000 },
    ]);
    // a row with a different uri but the same names is still not a match
    const uriRows = [uriRow(2, "2024-03-01T12:00:00Z", { trackUri: "spotify:track:other", source: "export-extended" })];
    expect(matchPlays(uriRows, [api("2024-03-01T12:00:00Z")], { kind: "api", toleranceMs: BASIC_MATCH_TOLERANCE_MS })).toEqual([]);
  });
});

describe("exportPatchForApiRow / apiPatchForExportRow", () => {
  const apiRow = () => {
    const d = playFromApiItem(apiItem(), "apisha", 4)!;
    return { ...d, id: 10, msPlayed: 200_000, msPlayedEstimated: true };
  };

  it("export wins the measured fields, the api keeps played_at, context and links", () => {
    const exp = playFromExtended(ext({ ts: "2024-03-01T12:00:00Z", skipped: true, reason_end: "fwdbtn", ms_played: 30_000 }), "fsha", 5)!;
    const row = apiRow();
    const p = exportPatchForApiRow(row, exp);
    expect(p.source).toBe("export-extended");
    expect(p.msPlayed).toBe(30_000);
    expect(p.msPlayedEstimated).toBe(false);
    expect(p.skipped).toBe(true);
    expect(p.reasonEnd).toBe("fwdbtn");
    expect(p.platform).toBe("ios");
    expect(p.exportRawSha256).toBe("fsha");
    expect(p.exportRawIndex).toBe(5);
    expect(p.exportDedupeKey).toBe(exp.exportDedupeKey);
    // started_at from the api's ms-precision played_at
    expect(p.startedAt!.toISOString()).toBe("2024-03-01T11:59:30.250Z");
    expect(p.trackUri).toBe("spotify:track:trk1");
    // nothing the api owns is in the patch
    expect(p).not.toHaveProperty("playedAt");
    expect(p).not.toHaveProperty("contextUri");
    expect(p).not.toHaveProperty("apiDedupeKey");
    expect(p).not.toHaveProperty("apiRawSha256");
    const merged = { ...row, ...p };
    expect(merged.playedAt.toISOString()).toBe("2024-03-01T12:00:00.250Z");
    expect(merged.contextUri).toBe("spotify:playlist:pl1");
    expect(merged.apiDedupeKey).toBe(row.apiDedupeKey);
  });

  it("keeps the api item type when the export's is unknown", () => {
    const exp = playFromExtended(ext({ spotify_track_uri: null, master_metadata_track_name: null }), null, 0)!;
    expect(exportPatchForApiRow(apiRow(), exp).itemType).toBe("track");
  });

  it("api patch adds context, links and the uri a basic row lacks", () => {
    const basic = playFromBasic({ endTime: "2024-03-01 12:00", artistName: "Artist One", trackName: "Song One", msPlayed: 99_000 }, "bsha", 0)!;
    const row = { ...basic, id: 3 };
    const api = playFromApiItem(apiItem(), "apisha", 4)!;
    const p = apiPatchForExportRow(row, api);
    expect(p).toEqual({
      trackUri: "spotify:track:trk1",
      trackId: "trk1",
      episodeUri: null,
      albumName: "Album One",
      itemType: "track",
      contextType: "playlist",
      contextUri: "spotify:playlist:pl1",
      apiRawSha256: "apisha",
      apiRawIndex: 4,
      apiDedupeKey: api.apiDedupeKey,
    });
    expect(p).not.toHaveProperty("msPlayed");
  });
});

describe("estimateMsPlayed", () => {
  const p = (at: string, durationMs: number | null, needsEstimate = true) => ({ playedAt: T(at), durationMs, needsEstimate });

  it("caps the gap at the duration; the first play with no prev gets the duration", () => {
    expect(
      estimateMsPlayed([p("2024-03-01T12:00:00Z", 240_000), p("2024-03-01T12:07:00Z", 180_000), p("2024-03-01T12:10:00Z", 200_000)], null)
    ).toEqual([240_000, 180_000, 180_000]);
  });

  it("measures the first gap from prev", () => {
    expect(estimateMsPlayed([p("2024-03-01T12:01:00Z", 200_000)], T("2024-03-01T12:00:00Z"))).toEqual([60_000]);
  });

  it("exact rows aren't estimated but still advance the timeline", () => {
    expect(
      estimateMsPlayed([p("2024-03-01T12:00:00Z", 200_000, false), p("2024-03-01T12:00:30Z", 200_000)], T("2024-03-01T11:00:00Z"))
    ).toEqual([null, 30_000]);
  });

  it("unknown duration gives null but still advances", () => {
    expect(estimateMsPlayed([p("2024-03-01T12:00:00Z", null), p("2024-03-01T12:00:20Z", 100_000)], null)).toEqual([null, 20_000]);
    expect(estimateMsPlayed([p("2024-03-01T12:00:00Z", 0)], null)).toEqual([null]);
  });
});

