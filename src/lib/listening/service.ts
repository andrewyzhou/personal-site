// wiring for the collector: real spotify + raw store + neon, or a dry run
// that calls spotify (read-only) and writes nothing anywhere. server-only.

import { getAccessToken } from "../spotify";
import { getRawStore, isRawStoreConfigured, sha256Hex } from "../raw-store";
import { collectRecentlyPlayed, type CollectResult } from "./collect";
import type { RawSink } from "./metadata-fill";
import type { RecentPlay } from "./admin-data";
import { createMemoryRepo, readOnlyRepo, type ListeningRepo, type MemoryRepo, type PlayRecord } from "./repo";
import { dbListeningRepo, listeningTablesExist } from "./repo-db";
import { createSpotifyHttp } from "./spotify-api";

export class ListeningNotMigratedError extends Error {
  constructor() {
    super("listening tables do not exist yet (migration not applied)");
    this.name = "ListeningNotMigratedError";
  }
}

export function isListeningConfigured(): boolean {
  return Boolean(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET && process.env.SPOTIFY_REFRESH_TOKEN);
}

export function storeRawSink(): RawSink {
  const store = getRawStore();
  return {
    async put(bytes, metadata) {
      const r = await store.put(bytes, { kind: "spotify-api", contentType: "application/json", metadata });
      return r.sha256;
    },
  };
}

// hashes only: what the sha would be, nothing stored
export function dryRawSink(log?: { n: number; bytes: number }): RawSink {
  return {
    async put(bytes) {
      if (log) {
        log.n++;
        log.bytes += bytes.length;
      }
      return sha256Hex(bytes);
    },
  };
}

export interface RunOptions {
  dryRun?: boolean;
  maxLookups?: number;
}

export type RunResult = CollectResult & {
  dryRun: boolean;
  repo?: "neon" | "memory";
  raw?: { n: number; bytes: number };
  writes?: Record<string, number>;
  // dry run before the tables exist: the plays a real run would store
  preview?: RecentPlay[];
};

export function previewRow(p: PlayRecord): RecentPlay {
  return {
    id: p.id,
    playedAt: p.playedAt.toISOString(),
    source: p.source,
    itemType: p.itemType,
    title: p.trackName ?? p.episodeName ?? p.audiobookTitle,
    artist: p.artistName ?? p.showName,
    msPlayed: p.msPlayed,
    msPlayedEstimated: p.msPlayedEstimated,
    skipped: p.skipped,
    contextType: p.contextType,
  };
}

export async function runListeningCollect(opts: RunOptions = {}): Promise<RunResult> {
  if (!isListeningConfigured()) throw new Error("spotify is not configured (SPOTIFY_CLIENT_ID / _SECRET / _REFRESH_TOKEN)");
  const http = createSpotifyHttp({ getToken: () => getAccessToken() });

  if (opts.dryRun) {
    const raw = { n: 0, bytes: 0 };
    let repo: ListeningRepo & { writes?: Record<string, number> };
    let kind: "neon" | "memory" = "memory";
    try {
      if (process.env.DATABASE_URL && (await listeningTablesExist())) {
        repo = readOnlyRepo(dbListeningRepo());
        kind = "neon";
      } else {
        repo = createMemoryRepo();
      }
    } catch {
      repo = createMemoryRepo();
    }
    const r = await collectRecentlyPlayed({ http, raw: dryRawSink(raw), repo, maxLookups: opts.maxLookups });
    const preview =
      "plays" in repo
        ? [...(repo as MemoryRepo).plays]
            .sort((a, b) => b.playedAt.getTime() - a.playedAt.getTime())
            .slice(0, 20)
            .map(previewRow)
        : undefined;
    return { ...r, dryRun: true, repo: kind, raw, writes: repo.writes, preview };
  }

  if (!isRawStoreConfigured()) throw new Error("R2_RAW_BUCKET is not set: listening history is stored raw first");
  if (!(await listeningTablesExist())) throw new ListeningNotMigratedError();
  const r = await collectRecentlyPlayed({ http, raw: storeRawSink(), repo: dbListeningRepo(), maxLookups: opts.maxLookups });
  return { ...r, dryRun: false };
}
