// recently-played collector. raw first: each response is stored byte-for-byte
// before it's parsed, and rows link back to it. idempotent: re-running over
// the same plays inserts nothing (api dedupe key), and the cursor only moves
// once the plays are stored.
//
// the endpoint keeps only the last ~50 plays and, even with `after`, returns
// the newest ones first, so a run asks for the newest page and then walks back
// with `before` until it reaches the cursor (or spotify has nothing older).

import type { ListeningRunStats } from "../db/listening-schema";
import {
  BASIC_MATCH_TOLERANCE_MS,
  EXTENDED_MATCH_TOLERANCE_MS,
  apiPatchForExportRow,
  estimateMsPlayed,
  matchPlays,
  type ExistingPlay,
} from "./merge";
import { metaFromTrack, type AlbumMeta, type ArtistMeta, type TrackMeta } from "./metadata";
import { playFromApiItem, startedAtFor, type ApiRecentPage, type ApiTrack, type PlayDraft } from "./normalize";
import type { ListeningRepo, SyncState } from "./repo";
import { fillMetadata, type RawSink } from "./metadata-fill";
import { SpotifyRateLimitError, recentlyPlayedUrl, type SpotifyHttp } from "./spotify-api";

export interface CollectOptions {
  http: SpotifyHttp;
  raw: RawSink;
  repo: ListeningRepo;
  maxPages?: number;
  // metadata lookup requests per run (each is one batch call)
  maxLookups?: number;
  now?: () => Date;
}

export interface CollectResult extends ListeningRunStats {
  ok: boolean;
  cursor: string | null;
  error?: string;
}

const decode = (b: Uint8Array) => JSON.parse(new TextDecoder().decode(b));

export async function collectRecentlyPlayed(opts: CollectOptions): Promise<CollectResult> {
  const now = opts.now ?? (() => new Date());
  const started = now().getTime();
  const maxPages = opts.maxPages ?? 5;
  const stats: ListeningRunStats = {
    pages: 0,
    fetched: 0,
    inserted: 0,
    merged: 0,
    duplicates: 0,
    estimated: 0,
    metadata: { tracks: 0, artists: 0, albums: 0, failed: 0 },
    possibleGap: false,
    durationMs: 0,
  };
  const prevState = await opts.repo.getState();
  const cursor = prevState?.cursorPlayedAt ?? null;
  let newCursor = cursor;

  try {
    // ---- fetch (raw first)
    const drafts: PlayDraft[] = [];
    const durations = new Map<string, number | null>(); // api dedupe key → duration
    const tracks = new Map<string, TrackMeta>();
    const albums = new Map<string, AlbumMeta>();
    const artists = new Map<string, ArtistMeta>();
    let url = recentlyPlayedUrl(cursor ? { after: cursor.getTime() } : {});
    let reachedCursor = false;
    for (let page = 0; page < maxPages; page++) {
      const res = await opts.http.get(url);
      stats.pages++;
      const body = decode(res.bytes) as ApiRecentPage;
      const items = body.items ?? [];
      stats.fetched += items.length;
      // a page with no new plays isn't used for history and isn't kept (the
      // same 50 plays would otherwise be stored again every run)
      const hasNew = items.some((it) => !cursor || new Date(it.played_at) > cursor);
      const sha = hasNew
        ? await opts.raw.put(res.bytes, { url: res.url, fetchedAt: res.fetchedAt.toISOString(), status: res.status })
        : null;
      items.forEach((item, i) => {
        const d = playFromApiItem(item, sha, i);
        if (!d) return;
        if (cursor && d.playedAt <= cursor) {
          reachedCursor = true;
          return;
        }
        drafts.push(d);
        durations.set(d.apiDedupeKey!, item.track?.duration_ms ?? null);
        const m = metaFromTrack(item.track as ApiTrack, sha, res.fetchedAt);
        if (m.track) tracks.set(m.track.id, m.track);
        for (const a of m.albums) if (!albums.has(a.id)) albums.set(a.id, a);
        for (const a of m.artists) if (!artists.has(a.id)) artists.set(a.id, a);
      });
      const before = body.cursors?.before;
      if (reachedCursor || items.length === 0 || !before) break;
      url = recentlyPlayedUrl({ before: Number(before) });
    }
    // walked back as far as spotify goes without reaching the cursor: plays
    // between the cursor and the oldest one returned are gone from the api
    if (!reachedCursor && cursor && drafts.length > 0) stats.possibleGap = true;

    // ---- dedupe within the run (overlapping pages)
    const byKey = new Map<string, PlayDraft>();
    for (const d of drafts) if (!byKey.has(d.apiDedupeKey!)) byKey.set(d.apiDedupeKey!, d);
    const fresh = [...byKey.values()].sort((a, b) => a.playedAt.getTime() - b.playedAt.getTime());

    if (fresh.length > 0) {
      const first = fresh[0].playedAt.getTime();
      const last = fresh[fresh.length - 1].playedAt.getTime();
      const existing = await opts.repo.playsBetween(
        new Date(first - BASIC_MATCH_TOLERANCE_MS),
        new Date(last + BASIC_MATCH_TOLERANCE_MS)
      );
      const knownApiKeys = new Set(existing.map((e) => e.apiDedupeKey).filter(Boolean));
      let pending = fresh.filter((d) => {
        if (knownApiKeys.has(d.apiDedupeKey!)) {
          stats.duplicates++;
          return false;
        }
        return true;
      });

      // ---- merge onto export rows already holding the same play
      for (const [source, tol] of [
        ["export-extended", EXTENDED_MATCH_TOLERANCE_MS],
        ["export-basic", BASIC_MATCH_TOLERANCE_MS],
      ] as const) {
        const pool = existing.filter((e) => e.source === source) as ExistingPlay[];
        if (pool.length === 0 || pending.length === 0) continue;
        const matches = matchPlays(pool, pending, { kind: "api", toleranceMs: tol });
        const matched = new Set<number>();
        for (const m of matches) {
          const row = existing.find((e) => e.id === m.existingId)!;
          await opts.repo.updatePlay(row.id, apiPatchForExportRow(row, pending[m.incomingIndex]));
          matched.add(m.incomingIndex);
          stats.merged++;
        }
        pending = pending.filter((_, i) => !matched.has(i));
      }

      // ---- estimate ms_played from the gap to the previous play (any source)
      const prev = await opts.repo.latestPlayedAtBefore(new Date(first - BASIC_MATCH_TOLERANCE_MS));
      const timeline = [
        ...existing.map((e) => ({ playedAt: e.playedAt, durationMs: null, needsEstimate: false, draft: null as PlayDraft | null })),
        ...pending.map((d) => ({ playedAt: d.playedAt, durationMs: durations.get(d.apiDedupeKey!) ?? null, needsEstimate: true, draft: d })),
      ].sort((a, b) => a.playedAt.getTime() - b.playedAt.getTime());
      const est = estimateMsPlayed(timeline, prev);
      timeline.forEach((t, i) => {
        if (!t.draft || est[i] === null) return;
        t.draft.msPlayed = est[i];
        t.draft.msPlayedEstimated = true;
        t.draft.startedAt = startedAtFor(t.draft.playedAt, est[i]);
        stats.estimated++;
      });

      if (pending.length > 0) {
        const n = await opts.repo.insertPlays(pending);
        stats.inserted += n;
        stats.duplicates += pending.length - n;
      }
      newCursor = new Date(Math.max(last, cursor?.getTime() ?? 0));
    }

    // ---- metadata: embedded objects first, then lookups for what's missing
    await opts.repo.upsertTracks([...tracks.values()]);
    await opts.repo.upsertAlbums([...albums.values()]);
    await opts.repo.upsertArtists([...artists.values()]);
    stats.metadata.tracks += tracks.size;
    const filled = await fillMetadata({ http: opts.http, raw: opts.raw, repo: opts.repo, maxLookups: opts.maxLookups ?? 6, now });
    stats.metadata.tracks += filled.tracks;
    stats.metadata.artists += filled.artists;
    stats.metadata.albums += filled.albums;
    stats.metadata.failed += filled.failed;

    stats.durationMs = now().getTime() - started;
    await opts.repo.saveState(nextState(prevState, newCursor, now(), "ok", null, stats));
    return { ok: true, cursor: newCursor?.toISOString() ?? null, ...stats };
  } catch (error) {
    stats.durationMs = now().getTime() - started;
    const message =
      error instanceof SpotifyRateLimitError ? error.message : (error as Error).message ?? String(error);
    // the cursor stays where the last successful run left it
    await opts.repo.saveState(nextState(prevState, cursor, now(), "error", message, stats));
    return { ok: false, cursor: cursor?.toISOString() ?? null, error: message, ...stats };
  }
}

function nextState(
  prev: SyncState | null,
  cursor: Date | null,
  at: Date,
  status: "ok" | "error",
  error: string | null,
  stats: ListeningRunStats
): SyncState {
  return {
    cursorPlayedAt: cursor,
    lastRunAt: at,
    lastRunStatus: status,
    lastError: error,
    lastRunStats: stats,
    lastSuccessAt: status === "ok" ? at : (prev?.lastSuccessAt ?? null),
  };
}
