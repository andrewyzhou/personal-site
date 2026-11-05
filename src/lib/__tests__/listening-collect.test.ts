import { describe, it, expect, vi } from "vitest";
import { sha256Hex } from "@/lib/raw-store";
import { collectRecentlyPlayed } from "@/lib/listening/collect";
import { createMemoryRepo, type MemoryRepo, type SyncState } from "@/lib/listening/repo";
import { playFromBasic, playFromExtended, type ApiRecentItem, type ApiRecentPage } from "@/lib/listening/normalize";
import {
  API_BASE,
  SpotifyHttpError,
  SpotifyRateLimitError,
  createSpotifyHttp,
  parseRetryAfter,
  recentlyPlayedUrl,
  type SpotifyHttp,
} from "@/lib/listening/spotify-api";
import type { RawSink } from "@/lib/listening/metadata-fill";

const enc = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));
const ms = (s: string) => new Date(s).getTime();
const NOW = new Date("2024-03-01T13:00:00Z");
const now = () => NOW;

function item(id: string, playedAt: string, o: { dur?: number; artists?: string[]; album?: string } = {}): ApiRecentItem {
  const artists = (o.artists ?? ["ar1"]).map((a) => ({ id: a, name: `Artist ${a}` }));
  return {
    track: {
      id,
      uri: `spotify:track:${id}`,
      name: `Song ${id}`,
      type: "track",
      duration_ms: o.dur ?? 200_000,
      album: { id: o.album ?? "al1", name: `Album ${o.album ?? "al1"}`, artists: [artists[0]] },
      artists,
    },
    played_at: playedAt,
    context: { type: "playlist", uri: "spotify:playlist:pl1" },
  };
}

function page(items: ApiRecentItem[], before?: string): ApiRecentPage {
  return { items, next: null, cursors: before ? { before: String(ms(before)) } : null, limit: 50 };
}

const EMPTY = page([]);

function idsOf(url: string): string[] {
  return decodeURIComponent(new URL(url).searchParams.get("ids") ?? "").split(",").filter(Boolean);
}

function fullLookup(url: string): unknown {
  const kind = new URL(url).pathname.split("/").pop()!;
  const ids = idsOf(url);
  if (kind === "artists") {
    return { artists: ids.map((id) => ({ id, name: `Artist ${id}`, genres: ["indie"], popularity: 50, followers: { total: 10 }, images: [] })) };
  }
  if (kind === "albums") {
    return { albums: ids.map((id) => ({ id, name: `Album ${id}`, album_type: "album", label: "Label", genres: [], artists: [{ id: "ar1", name: "Artist ar1" }] })) };
  }
  return undefined;
}

// url → json body (or a function of the url, or an error to throw); records calls
function fakeHttp(routes: Record<string, unknown | Error>, fallback: (url: string) => unknown = fullLookup) {
  const calls: string[] = [];
  const http: SpotifyHttp = {
    async get(url) {
      calls.push(url);
      let body = url in routes ? routes[url] : undefined;
      if (body === undefined && url.includes("/me/player/recently-played")) body = EMPTY;
      if (body === undefined) body = fallback(url);
      if (body instanceof Error) throw body;
      if (body === undefined) throw new SpotifyHttpError(404, url, "not found");
      return { url, status: 200, bytes: enc(body), fetchedAt: NOW };
    },
  };
  return { http, calls };
}

function fakeRaw() {
  const puts: { sha: string; bytes: Uint8Array; metadata: Record<string, unknown> }[] = [];
  const raw: RawSink & { puts: typeof puts } = {
    puts,
    async put(bytes, metadata) {
      const sha = sha256Hex(bytes);
      puts.push({ sha, bytes, metadata });
      return sha;
    },
  };
  return raw;
}

function state(cursor: string, over: Partial<SyncState> = {}): SyncState {
  return {
    cursorPlayedAt: new Date(cursor),
    lastRunAt: null,
    lastRunStatus: "ok",
    lastError: null,
    lastRunStats: null,
    lastSuccessAt: new Date("2024-02-01T00:00:00Z"),
    ...over,
  };
}

const byTime = (repo: MemoryRepo) => [...repo.plays].sort((a, b) => a.playedAt.getTime() - b.playedAt.getTime());
const recentCalls = (calls: string[]) => calls.filter((c) => c.includes("recently-played"));

describe("collectRecentlyPlayed", () => {
  const first = page([
    item("t3", "2024-03-01T12:10:00Z", { dur: 200_000 }),
    item("t2", "2024-03-01T12:07:00Z", { dur: 180_000 }),
    item("t1", "2024-03-01T12:00:00Z", { dur: 240_000 }),
  ]);

  it("first run inserts plays with estimates, stores the page raw and sets the cursor", async () => {
    const repo = createMemoryRepo();
    const raw = fakeRaw();
    const { http, calls } = fakeHttp({ [recentlyPlayedUrl()]: first });
    const r = await collectRecentlyPlayed({ http, raw, repo, maxLookups: 0, now });

    expect(r.ok).toBe(true);
    expect(r).toMatchObject({ pages: 1, fetched: 3, inserted: 3, merged: 0, duplicates: 0, estimated: 3, possibleGap: false });
    expect(r.cursor).toBe("2024-03-01T12:10:00.000Z");
    expect(calls).toEqual([recentlyPlayedUrl()]);

    expect(raw.puts).toHaveLength(1);
    const sha = raw.puts[0].sha;
    expect(new TextDecoder().decode(raw.puts[0].bytes)).toBe(JSON.stringify(first));
    expect(raw.puts[0].metadata).toMatchObject({ url: recentlyPlayedUrl(), status: 200 });

    const plays = byTime(repo);
    expect(plays.map((p) => p.trackId)).toEqual(["t1", "t2", "t3"]);
    expect(plays.map((p) => p.apiRawSha256)).toEqual([sha, sha, sha]);
    expect(plays.map((p) => p.apiRawIndex)).toEqual([2, 1, 0]);
    // first: no prev → duration; then the gap, capped at the duration
    expect(plays.map((p) => p.msPlayed)).toEqual([240_000, 180_000, 180_000]);
    expect(plays.every((p) => p.msPlayedEstimated)).toBe(true);
    expect(plays[2].startedAt!.toISOString()).toBe("2024-03-01T12:07:00.000Z");

    expect(repo.state).toMatchObject({ lastRunStatus: "ok", lastError: null, lastRunAt: NOW, lastSuccessAt: NOW });
    expect(repo.state!.cursorPlayedAt!.toISOString()).toBe("2024-03-01T12:10:00.000Z");
    expect(repo.state!.lastRunStats).toMatchObject({ inserted: 3 });
  });

  it("a second run over the same page inserts nothing and stores nothing", async () => {
    const repo = createMemoryRepo();
    const raw = fakeRaw();
    const routes = {
      [recentlyPlayedUrl()]: first,
      [recentlyPlayedUrl({ after: ms("2024-03-01T12:10:00Z") })]: first,
    };
    await collectRecentlyPlayed({ http: fakeHttp(routes).http, raw, repo, maxLookups: 0, now });
    const { http, calls } = fakeHttp(routes);
    const r = await collectRecentlyPlayed({ http, raw, repo, maxLookups: 0, now });

    expect(calls).toEqual([recentlyPlayedUrl({ after: ms("2024-03-01T12:10:00Z") })]);
    expect(r).toMatchObject({ ok: true, inserted: 0, fetched: 3, estimated: 0, possibleGap: false });
    expect(r.cursor).toBe("2024-03-01T12:10:00.000Z");
    expect(raw.puts).toHaveLength(1);
    expect(repo.plays).toHaveLength(3);
    expect(repo.state!.cursorPlayedAt!.toISOString()).toBe("2024-03-01T12:10:00.000Z");
  });

  it("walks back with before until it reaches the cursor", async () => {
    const t1 = item("t1", "2024-03-01T12:00:00Z");
    const repo = createMemoryRepo({ state: state("2024-03-01T12:00:00Z") });
    await repo.insertPlays([
      { ...playFromBasic({ endTime: "2024-03-01 11:00", artistName: "x", trackName: "y", msPlayed: 1 }, null, 0)! },
    ]);
    const raw = fakeRaw();
    const newest = page([item("t5", "2024-03-01T12:20:00Z"), item("t4", "2024-03-01T12:16:00Z")], "2024-03-01T12:16:00Z");
    const older = page([item("t3", "2024-03-01T12:10:00Z"), t1], "2024-03-01T12:00:00Z");
    const { http, calls } = fakeHttp({
      [recentlyPlayedUrl({ after: ms("2024-03-01T12:00:00Z") })]: newest,
      [recentlyPlayedUrl({ before: ms("2024-03-01T12:16:00Z") })]: older,
    });
    const r = await collectRecentlyPlayed({ http, raw, repo, maxLookups: 0, now });

    expect(recentCalls(calls)).toEqual([
      recentlyPlayedUrl({ after: ms("2024-03-01T12:00:00Z") }),
      recentlyPlayedUrl({ before: ms("2024-03-01T12:16:00Z") }),
    ]);
    expect(r).toMatchObject({ ok: true, pages: 2, fetched: 4, inserted: 3, possibleGap: false });
    expect(r.cursor).toBe("2024-03-01T12:20:00.000Z");
    expect(raw.puts).toHaveLength(2);
    const ids = byTime(repo).map((p) => p.trackId);
    expect(ids).toEqual([null, "t3", "t4", "t5"]);
    // the older page's rows link to the older page
    const t3 = repo.plays.find((p) => p.trackId === "t3")!;
    expect(t3.apiRawSha256).toBe(raw.puts[1].sha);
    expect(t3.apiRawIndex).toBe(0);
  });

  it("flags a possible gap when spotify has nothing older and the cursor wasn't reached", async () => {
    const repo = createMemoryRepo({ state: state("2024-03-01T11:00:00Z") });
    const newest = page([item("t5", "2024-03-01T12:20:00Z"), item("t4", "2024-03-01T12:16:00Z")], "2024-03-01T12:16:00Z");
    const { http, calls } = fakeHttp({ [recentlyPlayedUrl({ after: ms("2024-03-01T11:00:00Z") })]: newest });
    const r = await collectRecentlyPlayed({ http, raw: fakeRaw(), repo, maxLookups: 0, now });
    expect(recentCalls(calls)).toHaveLength(2);
    expect(r).toMatchObject({ ok: true, inserted: 2, possibleGap: true });
    expect(repo.state!.lastRunStats!.possibleGap).toBe(true);
  });

  it("first run walks back until an empty page and dedupes overlapping pages", async () => {
    const repo = createMemoryRepo();
    const raw = fakeRaw();
    const p1 = page([item("t5", "2024-03-01T12:20:00Z"), item("t4", "2024-03-01T12:16:00Z")], "2024-03-01T12:16:00Z");
    // overlaps p1 by one play
    const p2 = page([item("t4", "2024-03-01T12:16:00Z"), item("t3", "2024-03-01T12:10:00Z")], "2024-03-01T12:10:00Z");
    const { http, calls } = fakeHttp({
      [recentlyPlayedUrl()]: p1,
      [recentlyPlayedUrl({ before: ms("2024-03-01T12:16:00Z") })]: p2,
    });
    const r = await collectRecentlyPlayed({ http, raw, repo, maxLookups: 0, now });
    expect(recentCalls(calls)).toEqual([
      recentlyPlayedUrl(),
      recentlyPlayedUrl({ before: ms("2024-03-01T12:16:00Z") }),
      recentlyPlayedUrl({ before: ms("2024-03-01T12:10:00Z") }),
    ]);
    expect(r).toMatchObject({ pages: 3, fetched: 4, inserted: 3, possibleGap: false });
    // the empty page isn't stored
    expect(raw.puts).toHaveLength(2);
    expect(byTime(repo).map((p) => p.trackId)).toEqual(["t3", "t4", "t5"]);
    // the first page seen wins the raw link
    expect(repo.plays.find((p) => p.trackId === "t4")!.apiRawSha256).toBe(raw.puts[0].sha);
  });

  it("merges onto an export-extended row within 15 s instead of adding a row", async () => {
    const exp = playFromExtended(
      {
        ts: "2024-03-01T12:00:10Z",
        ms_played: 123_456,
        spotify_track_uri: "spotify:track:t1",
        master_metadata_track_name: "Song t1",
        master_metadata_album_artist_name: "Artist ar1",
        reason_end: "fwdbtn",
      },
      "expsha",
      0
    )!;
    const repo = createMemoryRepo({ plays: [{ ...exp, id: 1 }] });
    const { http } = fakeHttp({ [recentlyPlayedUrl()]: page([item("t1", "2024-03-01T12:00:00.250Z")]) });
    const r = await collectRecentlyPlayed({ http, raw: fakeRaw(), repo, maxLookups: 0, now });

    expect(r).toMatchObject({ ok: true, merged: 1, inserted: 0, estimated: 0 });
    expect(repo.plays).toHaveLength(1);
    const row = repo.plays[0];
    expect(row.source).toBe("export-extended");
    expect(row.msPlayed).toBe(123_456);
    expect(row.msPlayedEstimated).toBe(false);
    expect(row.reasonEnd).toBe("fwdbtn");
    expect(row.playedAt.toISOString()).toBe("2024-03-01T12:00:10.000Z");
    expect(row.contextUri).toBe("spotify:playlist:pl1");
    expect(row.apiDedupeKey).toBe("api:spotify:track:t1@2024-03-01T12:00:00.250Z");
    expect(row.exportDedupeKey).toBe(exp.exportDedupeKey);
    expect(r.cursor).toBe("2024-03-01T12:00:00.250Z");

    // a later run over the same play sees it as a duplicate
    const again = await collectRecentlyPlayed({
      http: fakeHttp({ [recentlyPlayedUrl()]: page([item("t1", "2024-03-01T12:00:00.250Z")]) }).http,
      raw: fakeRaw(),
      repo: Object.assign(repo, { state: null }),
      maxLookups: 0,
      now,
    });
    expect(again).toMatchObject({ merged: 0, inserted: 0, duplicates: 1 });
  });

  it("doesn't merge onto an export row more than 15 s away", async () => {
    const exp = playFromExtended({ ts: "2024-03-01T12:00:20Z", ms_played: 1000, spotify_track_uri: "spotify:track:t1" }, null, 0)!;
    const repo = createMemoryRepo({ plays: [{ ...exp, id: 1 }] });
    const { http } = fakeHttp({ [recentlyPlayedUrl()]: page([item("t1", "2024-03-01T12:00:00Z")]) });
    const r = await collectRecentlyPlayed({ http, raw: fakeRaw(), repo, maxLookups: 0, now });
    expect(r).toMatchObject({ merged: 0, inserted: 1 });
    expect(repo.plays).toHaveLength(2);
  });

  it("merges onto a uri-less basic row by names and fills its uri", async () => {
    const basic = playFromBasic({ endTime: "2024-03-01 12:00", artistName: "Artist ar1", trackName: "Song t1", msPlayed: 99_000 }, "bsha", 0)!;
    const repo = createMemoryRepo({ plays: [{ ...basic, id: 1 }] });
    const { http } = fakeHttp({ [recentlyPlayedUrl()]: page([item("t1", "2024-03-01T12:00:40Z")]) });
    const r = await collectRecentlyPlayed({ http, raw: fakeRaw(), repo, maxLookups: 0, now });
    expect(r).toMatchObject({ merged: 1, inserted: 0 });
    expect(repo.plays).toHaveLength(1);
    expect(repo.plays[0]).toMatchObject({ source: "export-basic", msPlayed: 99_000, trackUri: "spotify:track:t1", trackId: "t1" });
  });

  describe("metadata", () => {
    const meta = page([
      item("t2", "2024-03-01T12:05:00Z", { artists: ["ar2"], album: "al2" }),
      item("t1", "2024-03-01T12:00:00Z", { artists: ["ar1"], album: "al1" }),
    ]);

    it("stores embedded tracks and fills artist and album stubs by lookup", async () => {
      const repo = createMemoryRepo();
      const { http, calls } = fakeHttp({ [recentlyPlayedUrl()]: meta });
      const r = await collectRecentlyPlayed({ http, raw: fakeRaw(), repo, now });
      expect(r.ok).toBe(true);
      expect([...repo.tracks.keys()].sort()).toEqual(["t1", "t2"]);
      expect(repo.tracks.get("t1")).toMatchObject({ durationMs: 200_000, albumId: "al1", artistIds: ["ar1"], complete: true });
      const lookups = calls.filter((c) => !c.includes("recently-played"));
      expect(lookups).toHaveLength(2);
      expect(lookups[0].startsWith(`${API_BASE}/artists?ids=`)).toBe(true);
      expect(idsOf(lookups[0]).sort()).toEqual(["ar1", "ar2"]);
      expect(lookups[1].startsWith(`${API_BASE}/albums?ids=`)).toBe(true);
      expect(repo.artists.get("ar2")).toMatchObject({ complete: true, genres: ["indie"], followers: 10 });
      // album lookup's embedded artist stub doesn't downgrade the complete row
      expect(repo.artists.get("ar1")!.complete).toBe(true);
      expect(repo.albums.get("al2")).toMatchObject({ complete: true, label: "Label" });
      expect(r.metadata).toEqual({ tracks: 2, artists: 2, albums: 2, failed: 0 });
    });

    it("stops at maxLookups", async () => {
      const repo = createMemoryRepo();
      const { http, calls } = fakeHttp({ [recentlyPlayedUrl()]: meta });
      const r = await collectRecentlyPlayed({ http, raw: fakeRaw(), repo, maxLookups: 1, now });
      const lookups = calls.filter((c) => !c.includes("recently-played"));
      expect(lookups).toHaveLength(1);
      expect(lookups[0]).toContain("/artists?");
      expect(repo.albums.get("al1")!.complete).toBe(false);
      expect(r.metadata.albums).toBe(0);
    });

    it("marks ids spotify returns null for as looked up", async () => {
      const repo = createMemoryRepo();
      const raw = fakeRaw();
      const { http } = fakeHttp({ [recentlyPlayedUrl()]: meta }, (url) => {
        if (url.includes("/artists?")) {
          return { artists: idsOf(url).map((id) => (id === "ar2" ? null : { id, name: `Artist ${id}`, genres: ["rock"] })) };
        }
        return fullLookup(url);
      });
      const r = await collectRecentlyPlayed({ http, raw, repo, now });
      expect(r.ok).toBe(true);
      expect(repo.artists.get("ar1")).toMatchObject({ complete: true, genres: ["rock"] });
      expect(repo.artists.get("ar2")).toMatchObject({ complete: true, genres: null });
      expect(r.metadata.failed).toBe(1);
      // lookups are stored raw too, and rows link to them
      expect(raw.puts.length).toBe(3);
      expect(repo.artists.get("ar1")!.rawSha256).toBe(raw.puts[1].sha);
    });

    it("a long 429 stops the fill without failing the run", async () => {
      const repo = createMemoryRepo();
      const seen: string[] = [];
      const fetchImpl = vi.fn(async (url: string) => {
        seen.push(url);
        if (url.includes("recently-played")) {
          return new Response(new TextDecoder().decode(enc(url === recentlyPlayedUrl() ? meta : EMPTY)), { status: 200 });
        }
        return new Response("slow down", { status: 429, headers: { "retry-after": "120" } });
      });
      const sleep = vi.fn(async () => {});
      const http = createSpotifyHttp({ getToken: async () => "tok", fetchImpl: fetchImpl as unknown as typeof fetch, sleep });
      const r = await collectRecentlyPlayed({ http, raw: fakeRaw(), repo, now });
      expect(r.ok).toBe(true);
      expect(r.inserted).toBe(2);
      expect(sleep).not.toHaveBeenCalled();
      expect(seen.filter((u) => u.includes("/artists?"))).toHaveLength(1);
      expect(seen.some((u) => u.includes("/albums?"))).toBe(false);
      expect(repo.artists.get("ar1")!.complete).toBe(false);
      expect(repo.state!.lastRunStatus).toBe("ok");
    });
  });

  it("an error fetching recently-played fails the run and keeps the cursor", async () => {
    const prev = state("2024-03-01T11:00:00Z");
    const repo = createMemoryRepo({ state: prev });
    const { http } = fakeHttp({
      [recentlyPlayedUrl({ after: ms("2024-03-01T11:00:00Z") })]: new SpotifyHttpError(503, recentlyPlayedUrl(), "down"),
    });
    const r = await collectRecentlyPlayed({ http, raw: fakeRaw(), repo, now });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("spotify 503");
    expect(r.cursor).toBe("2024-03-01T11:00:00.000Z");
    expect(repo.state).toMatchObject({ lastRunStatus: "error", lastRunAt: NOW, lastSuccessAt: prev.lastSuccessAt });
    expect(repo.state!.lastError).toContain("spotify 503");
    expect(repo.state!.cursorPlayedAt!.toISOString()).toBe("2024-03-01T11:00:00.000Z");
    expect(repo.plays).toHaveLength(0);
  });
});

describe("createSpotifyHttp", () => {
  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
  function setup(responses: Response[]) {
    const fetchImpl = vi.fn(async (...args: [string, RequestInit?]) => {
      void args;
      return responses.shift()!;
    });
    const sleep = vi.fn(async (ms: number) => {
      void ms;
    });
    const getToken = vi.fn(async (force?: boolean) => (force ? "fresh" : "stale"));
    const http = createSpotifyHttp({ getToken, fetchImpl: fetchImpl as unknown as typeof fetch, sleep });
    return { http, fetchImpl, sleep, getToken };
  }
  const auth = (init: unknown) => ((init as RequestInit).headers as Record<string, string>).Authorization;

  it("returns the exact bytes", async () => {
    const { http, fetchImpl } = setup([new Response('{"a": 1}', { status: 200 })]);
    const r = await http.get(`${API_BASE}/x`);
    expect(new TextDecoder().decode(r.bytes)).toBe('{"a": 1}');
    expect(r).toMatchObject({ url: `${API_BASE}/x`, status: 200 });
    expect(auth(fetchImpl.mock.calls[0][1])).toBe("Bearer stale");
  });

  it("honors retry-after on 429", async () => {
    const { http, sleep, fetchImpl } = setup([new Response("", { status: 429, headers: { "retry-after": "2" } }), ok({})]);
    await http.get(`${API_BASE}/x`);
    expect(sleep).toHaveBeenCalledWith(2000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("throws a rate limit error for waits above the max", async () => {
    const { http, sleep } = setup([new Response("", { status: 429, headers: { "retry-after": "11" } })]);
    const err = await http.get(`${API_BASE}/x`).catch((e) => e);
    expect(err).toBeInstanceOf(SpotifyRateLimitError);
    expect(err.retryAfterS).toBe(11);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("refreshes the token once on 401", async () => {
    const { http, getToken, fetchImpl } = setup([new Response("", { status: 401 }), ok({})]);
    await http.get(`${API_BASE}/x`);
    expect(getToken.mock.calls).toEqual([[false], [true]]);
    expect(auth(fetchImpl.mock.calls[1][1])).toBe("Bearer fresh");
    // the token is cached afterwards
    fetchImpl.mockResolvedValueOnce(ok({}));
    await http.get(`${API_BASE}/y`);
    expect(getToken).toHaveBeenCalledTimes(2);
  });

  it("a second 401 throws", async () => {
    const { http, getToken } = setup([new Response("", { status: 401 }), new Response("nope", { status: 401 })]);
    const err = await http.get(`${API_BASE}/x`).catch((e) => e);
    expect(err).toBeInstanceOf(SpotifyHttpError);
    expect(err.status).toBe(401);
    expect(getToken).toHaveBeenCalledTimes(2);
  });

  it("retries 5xx with backoff, then gives up", async () => {
    const a = setup([new Response("", { status: 503 }), new Response("", { status: 502 }), ok({})]);
    await a.http.get(`${API_BASE}/x`);
    expect(a.sleep.mock.calls).toEqual([[500], [1000]]);

    const b = setup([1, 2, 3, 4].map(() => new Response("down", { status: 500 })));
    const err = await b.http.get(`${API_BASE}/x`).catch((e) => e);
    expect(err).toBeInstanceOf(SpotifyHttpError);
    expect(err.status).toBe(500);
    expect(b.fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("throws SpotifyHttpError for other non-200s", async () => {
    const { http, fetchImpl } = setup([new Response("missing", { status: 404 })]);
    const err = await http.get(`${API_BASE}/tracks?ids=x`).catch((e) => e);
    expect(err).toBeInstanceOf(SpotifyHttpError);
    expect(err.status).toBe(404);
    expect(err.message).toBe("spotify 404 for /tracks?ids=x: missing");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("parseRetryAfter", () => {
  it("reads seconds, http dates and falls back to 1", () => {
    expect(parseRetryAfter(null)).toBe(1);
    expect(parseRetryAfter("")).toBe(1);
    expect(parseRetryAfter("0")).toBe(0);
    expect(parseRetryAfter("3")).toBe(3);
    expect(parseRetryAfter("2.1")).toBe(3);
    expect(parseRetryAfter("soon")).toBe(1);
    const inFive = new Date(Date.now() + 5000).toUTCString();
    expect(parseRetryAfter(inFive)).toBeGreaterThanOrEqual(4);
    expect(parseRetryAfter(inFive)).toBeLessThanOrEqual(5);
    expect(parseRetryAfter(new Date(Date.now() - 60_000).toUTCString())).toBe(0);
  });
});
