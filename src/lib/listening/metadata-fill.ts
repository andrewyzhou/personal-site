// fills the metadata cache in batches: tracks the plays reference but nobody
// has looked up (export-only plays), then artist and album stubs. bounded per
// run; a rate limit stops the fill without failing the run (the next run
// continues where this one stopped).

import { albumMeta, artistMeta, metaFromTrack, type AlbumMeta, type ApiAlbumFull, type ApiArtistFull, type ArtistMeta, type TrackMeta } from "./metadata";
import type { ApiTrack } from "./normalize";
import type { ListeningRepo } from "./repo";
import {
  ALBUMS_BATCH,
  ARTISTS_BATCH,
  SpotifyRateLimitError,
  TRACKS_BATCH,
  chunk,
  lookupUrl,
  type SpotifyHttp,
} from "./spotify-api";

export interface RawSink {
  // stores the exact bytes (write-once, content-addressed); resolves the sha256
  put(bytes: Uint8Array, metadata: Record<string, unknown>): Promise<string>;
}

export interface FillResult {
  tracks: number;
  artists: number;
  albums: number;
  failed: number;
  requests: number;
  rateLimited: boolean;
}

const decode = (b: Uint8Array) => JSON.parse(new TextDecoder().decode(b));

export async function fillMetadata(opts: {
  http: SpotifyHttp;
  raw: RawSink;
  repo: ListeningRepo;
  maxLookups: number;
  now: () => Date;
}): Promise<FillResult> {
  const r: FillResult = { tracks: 0, artists: 0, albums: 0, failed: 0, requests: 0, rateLimited: false };
  const budgetLeft = () => opts.maxLookups - r.requests;

  async function lookup<T>(kind: "tracks" | "artists" | "albums", ids: string[], handle: (items: (T | null)[], sha: string, at: Date) => Promise<void>) {
    r.requests++;
    const res = await opts.http.get(lookupUrl(kind, ids));
    const sha = await opts.raw.put(res.bytes, { url: res.url, fetchedAt: res.fetchedAt.toISOString(), status: res.status });
    const body = decode(res.bytes) as Record<string, (T | null)[]>;
    await handle(body[kind] ?? [], sha, res.fetchedAt);
  }

  const steps: { kind: "tracks" | "artists" | "albums"; batch: number; ids: (n: number) => Promise<string[]> }[] = [
    { kind: "tracks", batch: TRACKS_BATCH, ids: (n) => opts.repo.missingTrackIds(n) },
    { kind: "artists", batch: ARTISTS_BATCH, ids: (n) => opts.repo.incompleteArtistIds(n) },
    { kind: "albums", batch: ALBUMS_BATCH, ids: (n) => opts.repo.incompleteAlbumIds(n) },
  ];

  try {
    for (const step of steps) {
      if (budgetLeft() <= 0) break;
      const ids = await step.ids(step.batch * budgetLeft());
      for (const group of chunk(ids, step.batch)) {
        if (budgetLeft() <= 0) break;
        try {
          await lookup<unknown>(step.kind, group, async (items, sha, at) => {
            const missing: string[] = [];
            const tracks: TrackMeta[] = [];
            const albums: AlbumMeta[] = [];
            const artists: ArtistMeta[] = [];
            group.forEach((id, i) => {
              const item = items[i];
              if (!item) {
                missing.push(id);
                return;
              }
              if (step.kind === "tracks") {
                const m = metaFromTrack(item as ApiTrack, sha, at);
                if (m.track) tracks.push(m.track);
                else missing.push(id);
                albums.push(...m.albums);
                artists.push(...m.artists);
              } else if (step.kind === "artists") {
                const a = artistMeta(item as ApiArtistFull, sha, at, true);
                if (a) artists.push(a);
              } else {
                const al = albumMeta(item as ApiAlbumFull, sha, at, true);
                if (al) albums.push(al);
                for (const a of (item as ApiAlbumFull).artists ?? []) {
                  const am = artistMeta(a, sha, at, false);
                  if (am) artists.push(am);
                }
              }
            });
            if (tracks.length) await opts.repo.upsertTracks(tracks);
            if (albums.length) await opts.repo.upsertAlbums(albums);
            if (artists.length) await opts.repo.upsertArtists(artists);
            if (missing.length) await opts.repo.markUnavailable(step.kind, missing, at);
            r.tracks += tracks.length;
            r.artists += artists.filter((a) => a.complete).length;
            r.albums += albums.filter((a) => a.complete).length;
            r.failed += missing.length;
          });
        } catch (error) {
          if (error instanceof SpotifyRateLimitError) throw error;
          r.failed += group.length;
        }
      }
    }
  } catch (error) {
    if (!(error instanceof SpotifyRateLimitError)) throw error;
    r.rateLimited = true;
  }
  return r;
}
