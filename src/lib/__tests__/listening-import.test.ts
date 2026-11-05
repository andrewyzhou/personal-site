import { describe, it, expect, vi } from "vitest";
import { unzipSync, zipSync } from "fflate";
import { sha256Hex } from "@/lib/raw-store";
import { classifyExportPath, importExport, parseExportEntries, type ImportRaw } from "@/lib/listening/export-import";
import { createMemoryRepo, type MemoryRepo } from "@/lib/listening/repo";
import { playFromApiItem, type ApiRecentItem } from "@/lib/listening/normalize";

const enc = (v: unknown) => new TextEncoder().encode(typeof v === "string" ? v : JSON.stringify(v));

const EXT_DIR = "Spotify Extended Streaming History";
const BASIC_DIR = "Spotify Account Data";
const AUDIO = `${EXT_DIR}/Streaming_History_Audio_2023-2024_0.json`;
const VIDEO = `${EXT_DIR}/Streaming_History_Video_2024.json`;
const PDF = `${EXT_DIR}/ReadMeFirst_ExtendedStreamingHistory.pdf`;
const MUSIC = `${BASIC_DIR}/StreamingHistory_music_0.json`;
const PODCAST = `${BASIC_DIR}/StreamingHistory_podcast_0.json`;

// every documented field, null where it doesn't apply
function extRow(over: Record<string, unknown>): Record<string, unknown> {
  return {
    ts: null,
    platform: "ios",
    ms_played: 0,
    conn_country: "US",
    ip_addr: "203.0.113.7",
    master_metadata_track_name: null,
    master_metadata_album_artist_name: null,
    master_metadata_album_album_name: null,
    spotify_track_uri: null,
    episode_name: null,
    episode_show_name: null,
    spotify_episode_uri: null,
    audiobook_title: null,
    audiobook_uri: null,
    audiobook_chapter_uri: null,
    audiobook_chapter_title: null,
    reason_start: "trackdone",
    reason_end: "trackdone",
    shuffle: false,
    skipped: false,
    offline: false,
    offline_timestamp: null,
    incognito_mode: false,
    ...over,
  };
}

const songA = extRow({
  ts: "2024-01-10T08:03:30Z",
  ms_played: 200_000,
  master_metadata_track_name: "Song A",
  master_metadata_album_artist_name: "Artist A",
  master_metadata_album_album_name: "Album A",
  spotify_track_uri: "spotify:track:AAA",
  offline_timestamp: 1704873610,
});
const songB = extRow({
  ts: "2024-01-10T08:06:00Z",
  ms_played: 30_000,
  master_metadata_track_name: "Song B",
  master_metadata_album_artist_name: "Artist B",
  master_metadata_album_album_name: "Album B",
  spotify_track_uri: "spotify:track:BBB",
  reason_end: "fwdbtn",
  skipped: true,
  shuffle: true,
  some_new_field: "x",
});
const book = extRow({
  ts: "2023-06-01T20:00:00Z",
  ms_played: 600_000,
  audiobook_title: "Book",
  audiobook_uri: "spotify:audiobook:BK1",
  audiobook_chapter_uri: "spotify:chapter:CH1",
  audiobook_chapter_title: "Chapter 1",
});
const invalid = { platform: "ios", ms_played: 1000 };
const episode = extRow({
  ts: "2024-02-01T09:00:00Z",
  ms_played: 1_200_000,
  episode_name: "Ep 1",
  episode_show_name: "Show S",
  spotify_episode_uri: "spotify:episode:EEE",
});

const audioRows = [songA, songB, { ...songA }, invalid, book];
const videoRows = [episode];
const musicRows = [
  // covered by songA (endTime is the minute floor)
  { endTime: "2024-01-10 08:03", artistName: "Artist A", trackName: "Song A", msPlayed: 200_000 },
  { endTime: "2022-05-05 10:00", artistName: "Artist C", trackName: "Song C", msPlayed: 150_000 },
];
// covered by the video episode
const podcastRows = [{ endTime: "2024-02-01 09:00", podcastName: "Show S", episodeName: "Ep 1", msPlayed: 1_200_000 }];

function files(): Record<string, Uint8Array> {
  return {
    [AUDIO]: enc(audioRows),
    [VIDEO]: enc(videoRows),
    [PDF]: enc("%PDF-1.4 not really"),
    [MUSIC]: enc(musicRows),
    [PODCAST]: enc(podcastRows),
  };
}

function zipped() {
  const zipBytes = zipSync(files());
  const entries = Object.entries(unzipSync(zipBytes)).map(([path, bytes]) => ({ path, bytes }));
  return { zipBytes, parsed: parseExportEntries(entries) };
}

function fakeRaw() {
  const puts: { sha: string; opts: Parameters<ImportRaw["put"]>[1] }[] = [];
  const raw: ImportRaw & { puts: typeof puts } = {
    puts,
    async put(bytes, opts) {
      const sha = sha256Hex(bytes);
      puts.push({ sha, opts });
      return sha;
    },
  };
  return raw;
}

function apiRow(id: number, trackId: string, playedAt: string, msPlayed: number) {
  const item: ApiRecentItem = {
    track: { id: trackId, uri: `spotify:track:${trackId}`, name: `Song ${trackId}`, artists: [{ id: "x", name: "Someone" }] },
    played_at: playedAt,
    context: { type: "album", uri: "spotify:album:CTX" },
  };
  const d = playFromApiItem(item, "apisha", id)!;
  return { ...d, id, msPlayed, msPlayedEstimated: true, startedAt: new Date(d.playedAt.getTime() - msPlayed) };
}

const shaOf = (path: string) => sha256Hex(files()[path]);

describe("classifyExportPath", () => {
  it("sorts export files by kind", () => {
    expect(classifyExportPath(AUDIO)).toBe("extended");
    expect(classifyExportPath(VIDEO)).toBe("extended");
    expect(classifyExportPath("MyData/endsong_3.json")).toBe("extended");
    expect(classifyExportPath(MUSIC)).toBe("basic");
    expect(classifyExportPath(PODCAST)).toBe("basic");
    expect(classifyExportPath("MyData/StreamingHistory0.json")).toBe("basic");
    expect(classifyExportPath(PDF)).toBe("other");
    expect(classifyExportPath(`${BASIC_DIR}/Userdata.json`)).toBe("other");
    expect(classifyExportPath("Streaming_History_Audio_2024.pdf")).toBe("other");
  });
});

describe("parseExportEntries", () => {
  it("parses a real zip: counts, invalid rows, unknown fields, duplicates, covered basic rows", () => {
    const { parsed } = zipped();
    expect(parsed.files.map((f) => [f.path, f.kind, f.rows])).toEqual([
      [MUSIC, "basic", 2],
      [PODCAST, "basic", 1],
      [PDF, "other", 0],
      [AUDIO, "extended", 5],
      [VIDEO, "extended", 1],
    ]);
    expect(parsed.files.find((f) => f.path === AUDIO)!.sha256).toBe(shaOf(AUDIO));
    expect(parsed.invalidRows).toBe(1);
    expect(parsed.duplicateRows).toBe(1);
    expect(parsed.redundantBasic).toBe(2);
    expect(parsed.unknownFields).toEqual({ "extended.some_new_field": 1 });

    expect(parsed.drafts.map((d) => [d.source, d.itemType, d.playedAt.toISOString()])).toEqual([
      ["export-basic", "track", "2022-05-05T10:00:00.000Z"],
      ["export-extended", "audiobook", "2023-06-01T20:00:00.000Z"],
      ["export-extended", "track", "2024-01-10T08:03:30.000Z"],
      ["export-extended", "track", "2024-01-10T08:06:00.000Z"],
      ["export-extended", "episode", "2024-02-01T09:00:00.000Z"],
    ]);
    const b = parsed.drafts[3];
    expect(b).toMatchObject({ skipped: true, shuffle: true, reasonEnd: "fwdbtn", exportRawSha256: shaOf(AUDIO), exportRawIndex: 1 });
    expect(parsed.drafts[0]).toMatchObject({ exportRawSha256: shaOf(MUSIC), exportRawIndex: 1 });
  });

  it("keeps basic rows when there's no extended history", () => {
    const p = parseExportEntries([{ path: MUSIC, bytes: enc(musicRows) }]);
    expect(p.drafts).toHaveLength(2);
    expect(p.redundantBasic).toBe(0);
  });

  it("skips directories and rejects bad json", () => {
    expect(parseExportEntries([{ path: `${EXT_DIR}/`, bytes: new Uint8Array() }]).files).toEqual([]);
    expect(() => parseExportEntries([{ path: AUDIO, bytes: enc("{nope") }])).toThrow(/not valid json/);
    expect(() => parseExportEntries([{ path: AUDIO, bytes: enc({ a: 1 }) }])).toThrow(/not a json array/);
  });

  it("counts non-object rows as invalid", () => {
    const p = parseExportEntries([{ path: AUDIO, bytes: enc([null, 3, songA]) }]);
    expect(p.invalidRows).toBe(2);
    expect(p.drafts).toHaveLength(1);
  });
});

describe("importExport", () => {
  async function run(repo: MemoryRepo, dryRun = false) {
    const { zipBytes, parsed } = zipped();
    const raw = fakeRaw();
    const s = await importExport({ zipBytes, zipFilename: "my_spotify_data.zip", parsed, repo, raw, dryRun });
    return { s, raw, zipBytes };
  }

  it("stores the zip and each history file raw, not the pdf", async () => {
    const { raw, zipBytes, s } = await run(createMemoryRepo());
    expect(raw.puts.map((p) => p.opts.kind)).toEqual([
      "spotify-export-zip",
      "spotify-export-file",
      "spotify-export-file",
      "spotify-export-file",
      "spotify-export-file",
    ]);
    expect(raw.puts[0]).toMatchObject({ sha: sha256Hex(zipBytes), opts: { contentType: "application/zip", filename: "my_spotify_data.zip" } });
    const filePuts = raw.puts.slice(1);
    expect(filePuts.map((p) => p.opts.metadata.path)).toEqual([MUSIC, PODCAST, AUDIO, VIDEO]);
    expect(filePuts.map((p) => p.sha)).toEqual([MUSIC, PODCAST, AUDIO, VIDEO].map(shaOf));
    expect(filePuts[2].opts).toMatchObject({
      contentType: "application/json",
      filename: "Streaming_History_Audio_2023-2024_0.json",
      metadata: { zipSha256: sha256Hex(zipBytes), exportKind: "extended" },
    });
    expect(s.zip).toEqual({ sha256: sha256Hex(zipBytes), size: zipBytes.length, filename: "my_spotify_data.zip" });
  });

  it("merges onto api rows, inserts the rest and links rows to their files", async () => {
    const repo = createMemoryRepo({ plays: [apiRow(1, "AAA", "2024-01-10T08:03:30.412Z", 180_000)] });
    const { s } = await run(repo);

    expect(s).toMatchObject({
      plays: 5,
      byKind: { extended: 4, basic: 1 },
      range: { from: "2022-05-05T10:00:00.000Z", to: "2024-02-01T09:00:00.000Z" },
      inserted: 4,
      mergedWithApi: 1,
      alreadyImported: 0,
      redundantBasic: 2,
      duplicateRows: 1,
      invalidRows: 1,
      unknownFields: { "extended.some_new_field": 1 },
      msPlayed: 150_000 + 600_000 + 200_000 + 30_000 + 1_200_000,
      dryRun: false,
    });
    expect(repo.plays).toHaveLength(5);

    const merged = repo.plays.find((p) => p.id === 1)!;
    expect(merged).toMatchObject({
      source: "export-extended",
      msPlayed: 200_000,
      msPlayedEstimated: false,
      contextType: "album",
      contextUri: "spotify:album:CTX",
      apiRawSha256: "apisha",
      apiDedupeKey: "api:spotify:track:AAA@2024-01-10T08:03:30.412Z",
      exportRawSha256: shaOf(AUDIO),
      exportRawIndex: 0,
      platform: "ios",
      country: "US",
      offlineTimestamp: 1704873610,
      trackName: "Song A",
      artistName: "Artist A",
    });
    expect(merged.playedAt.toISOString()).toBe("2024-01-10T08:03:30.412Z");
    expect(merged.startedAt!.toISOString()).toBe("2024-01-10T08:00:10.412Z");

    const ep = repo.plays.find((p) => p.itemType === "episode")!;
    expect(ep).toMatchObject({ source: "export-extended", exportRawSha256: shaOf(VIDEO), exportRawIndex: 0, showName: "Show S" });
    const basic = repo.plays.find((p) => p.source === "export-basic")!;
    expect(basic).toMatchObject({ trackName: "Song C", exportRawSha256: shaOf(MUSIC), exportRawIndex: 1 });
  });

  it("merges a basic play onto an api row by names", async () => {
    const item: ApiRecentItem = {
      track: { id: "CCC", uri: "spotify:track:CCC", name: "Song C", artists: [{ id: "c", name: "Artist C" }] },
      played_at: "2022-05-05T10:00:41Z",
      context: null,
    };
    const api = { ...playFromApiItem(item, null, 0)!, id: 1, msPlayed: 100, msPlayedEstimated: true };
    const repo = createMemoryRepo({ plays: [api] });
    const { s } = await run(repo);
    expect(s.mergedWithApi).toBe(1);
    expect(repo.plays.find((p) => p.id === 1)).toMatchObject({ source: "export-basic", msPlayed: 150_000, msPlayedEstimated: false, trackUri: "spotify:track:CCC" });
  });

  it("is idempotent", async () => {
    const repo = createMemoryRepo({ plays: [apiRow(1, "AAA", "2024-01-10T08:03:30.412Z", 180_000)] });
    await run(repo);
    const snapshot = JSON.stringify(repo.plays);
    const update = vi.spyOn(repo, "updatePlay");
    const insert = vi.spyOn(repo, "insertPlays");
    const { s } = await run(repo);
    expect(s).toMatchObject({ alreadyImported: 5, inserted: 0, mergedWithApi: 0, reestimated: 0 });
    expect(update).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
    expect(JSON.stringify(repo.plays)).toBe(snapshot);
    expect(repo.imports).toHaveLength(2);
  });

  it("records the import only when applied", async () => {
    const dry = createMemoryRepo();
    const { s } = await run(dry, true);
    expect(s.dryRun).toBe(true);
    expect(dry.imports).toEqual([]);

    const real = createMemoryRepo();
    const { s: applied, zipBytes } = await run(real, false);
    expect(real.imports).toHaveLength(1);
    expect(real.imports[0]).toMatchObject({ zipSha256: sha256Hex(zipBytes), filename: "my_spotify_data.zip" });
    expect(real.imports[0].summary).toMatchObject({ inserted: applied.inserted, plays: 5 });
  });

  it("re-estimates an api row whose previous play arrives with the export", async () => {
    // collected with no earlier play known, so it got the full duration
    const repo = createMemoryRepo({ plays: [apiRow(1, "ZZZ", "2024-02-01T09:01:00Z", 240_000)] });
    await repo.upsertTracks([
      {
        id: "ZZZ",
        uri: "spotify:track:ZZZ",
        name: "Song ZZZ",
        durationMs: 240_000,
        albumId: null,
        artistIds: [],
        artistNames: [],
        explicit: null,
        popularity: null,
        isrc: null,
        discNumber: null,
        trackNumber: null,
        isLocal: null,
        rawSha256: null,
        fetchedAt: new Date(),
        complete: true,
      },
    ]);
    const { s } = await run(repo);
    expect(s.reestimated).toBe(1);
    const row = repo.plays.find((p) => p.id === 1)!;
    // the episode ended at 09:00:00
    expect(row).toMatchObject({ source: "api-recent", msPlayed: 60_000, msPlayedEstimated: true });
    expect(row.startedAt!.toISOString()).toBe("2024-02-01T09:00:00.000Z");
  });

  it("re-estimates an api row a few minutes after the export's last play", async () => {
    const repo = createMemoryRepo({ plays: [apiRow(1, "ZZZ", "2024-02-01T09:02:00Z", 240_000)] });
    await repo.upsertTracks([
      {
        id: "ZZZ",
        uri: "spotify:track:ZZZ",
        name: "Song ZZZ",
        durationMs: 240_000,
        albumId: null,
        artistIds: [],
        artistNames: [],
        explicit: null,
        popularity: null,
        isrc: null,
        discNumber: null,
        trackNumber: null,
        isLocal: null,
        rawSha256: null,
        fetchedAt: new Date(),
        complete: true,
      },
    ]);
    const { s } = await run(repo);
    expect(s.reestimated).toBe(1);
    expect(repo.plays.find((p) => p.id === 1)!.msPlayed).toBe(120_000);
  });

  it("leaves exact and unrelated rows alone", async () => {
    const repo = createMemoryRepo({ plays: [{ ...apiRow(1, "ZZZ", "2024-02-01T09:01:00Z", 240_000), msPlayedEstimated: false }] });
    const { s } = await run(repo);
    expect(s.reestimated).toBe(0);
    expect(repo.plays.find((p) => p.id === 1)!.msPlayed).toBe(240_000);
  });
});
