// storage interface for the collector and importer, plus an in-memory
// implementation (tests, and dry runs before the tables exist). the neon one
// is in repo-db.ts.

import type { ListeningRunStats } from "../db/listening-schema";
import type { AlbumMeta, ArtistMeta, TrackMeta } from "./metadata";
import type { PlayDraft } from "./normalize";

export type PlayRecord = PlayDraft & { id: number };

export interface SyncState {
  cursorPlayedAt: Date | null;
  lastRunAt: Date | null;
  lastRunStatus: string | null;
  lastError: string | null;
  lastRunStats: ListeningRunStats | null;
  lastSuccessAt: Date | null;
}

export interface ListeningRepo {
  getState(): Promise<SyncState | null>;
  saveState(state: SyncState): Promise<void>;
  playsBetween(from: Date, to: Date): Promise<PlayRecord[]>;
  latestPlayedAtBefore(t: Date): Promise<Date | null>;
  // conflict-do-nothing on either dedupe key; resolves the number inserted
  insertPlays(rows: PlayDraft[]): Promise<number>;
  updatePlay(id: number, patch: Partial<PlayDraft>): Promise<void>;
  // complete rows overwrite; stubs only fill gaps
  upsertTracks(rows: TrackMeta[]): Promise<void>;
  upsertArtists(rows: ArtistMeta[]): Promise<void>;
  upsertAlbums(rows: AlbumMeta[]): Promise<void>;
  missingTrackIds(limit: number): Promise<string[]>;
  incompleteArtistIds(limit: number): Promise<string[]>;
  incompleteAlbumIds(limit: number): Promise<string[]>;
  trackDurations(ids: string[]): Promise<Map<string, number>>;
  // ids spotify returned null for: mark them looked up so later runs skip them
  // (tracks get a nameless placeholder row; artists/albums keep their stub)
  markUnavailable(kind: "tracks" | "artists" | "albums", ids: string[], at: Date): Promise<void>;
  recordImport(row: { zipSha256: string; filename: string | null; summary: Record<string, unknown> }): Promise<void>;
}

export const STATE_ID = "spotify-recent";

export function placeholderTrack(id: string, at: Date): TrackMeta {
  return {
    id,
    uri: `spotify:track:${id}`,
    name: "",
    durationMs: null,
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
    fetchedAt: at,
    complete: true,
  };
}

export interface MemoryRepo extends ListeningRepo {
  plays: PlayRecord[];
  tracks: Map<string, TrackMeta>;
  artists: Map<string, ArtistMeta>;
  albums: Map<string, AlbumMeta>;
  state: SyncState | null;
  imports: { zipSha256: string; filename: string | null; summary: Record<string, unknown> }[];
}

function upsertInto<T extends { id: string; complete: boolean }>(map: Map<string, T>, rows: T[]) {
  for (const r of rows) {
    if (!map.has(r.id) || r.complete) map.set(r.id, r);
  }
}

export function createMemoryRepo(seed: Partial<Pick<MemoryRepo, "plays" | "state">> = {}): MemoryRepo {
  let nextId = 1 + Math.max(0, ...(seed.plays ?? []).map((p) => p.id));
  const repo: MemoryRepo = {
    plays: [...(seed.plays ?? [])],
    tracks: new Map(),
    artists: new Map(),
    albums: new Map(),
    state: seed.state ?? null,
    imports: [],
    async getState() {
      return repo.state;
    },
    async saveState(s) {
      repo.state = { ...s };
    },
    async playsBetween(from, to) {
      return repo.plays
        .filter((p) => p.playedAt >= from && p.playedAt <= to)
        .map((p) => ({ ...p }))
        .sort((a, b) => a.playedAt.getTime() - b.playedAt.getTime());
    },
    async latestPlayedAtBefore(t) {
      let best: Date | null = null;
      for (const p of repo.plays) if (p.playedAt < t && (!best || p.playedAt > best)) best = p.playedAt;
      return best;
    },
    async insertPlays(rows) {
      let n = 0;
      for (const r of rows) {
        const clash = repo.plays.some(
          (p) =>
            (r.apiDedupeKey && p.apiDedupeKey === r.apiDedupeKey) ||
            (r.exportDedupeKey && p.exportDedupeKey === r.exportDedupeKey)
        );
        if (clash) continue;
        repo.plays.push({ ...r, id: nextId++ });
        n++;
      }
      return n;
    },
    async updatePlay(id, patch) {
      const p = repo.plays.find((x) => x.id === id);
      if (p) Object.assign(p, patch);
    },
    async upsertTracks(rows) {
      upsertInto(repo.tracks, rows);
    },
    async upsertArtists(rows) {
      upsertInto(repo.artists, rows);
    },
    async upsertAlbums(rows) {
      upsertInto(repo.albums, rows);
    },
    async missingTrackIds(limit) {
      const ids = new Set<string>();
      for (const p of repo.plays) if (p.trackId && !repo.tracks.has(p.trackId)) ids.add(p.trackId);
      return [...ids].slice(0, limit);
    },
    async incompleteArtistIds(limit) {
      return [...repo.artists.values()].filter((a) => !a.complete).map((a) => a.id).slice(0, limit);
    },
    async incompleteAlbumIds(limit) {
      return [...repo.albums.values()].filter((a) => !a.complete).map((a) => a.id).slice(0, limit);
    },
    async trackDurations(ids) {
      const m = new Map<string, number>();
      for (const id of ids) {
        const d = repo.tracks.get(id)?.durationMs;
        if (d) m.set(id, d);
      }
      return m;
    },
    async markUnavailable(kind, ids, at) {
      for (const id of ids) {
        if (kind === "tracks") {
          if (!repo.tracks.has(id)) repo.tracks.set(id, placeholderTrack(id, at));
        } else {
          const cur = (kind === "artists" ? repo.artists : repo.albums).get(id);
          if (cur) cur.complete = true;
        }
      }
    },
    async recordImport(row) {
      repo.imports.push(row);
    },
  };
  return repo;
}

// reads go through, writes are counted and dropped (dry runs against neon)
export function readOnlyRepo(inner: ListeningRepo): ListeningRepo & { writes: Record<string, number> } {
  const writes: Record<string, number> = {};
  const count = (k: string, n = 1) => {
    writes[k] = (writes[k] ?? 0) + n;
  };
  return {
    writes,
    getState: () => inner.getState(),
    playsBetween: (a, b) => inner.playsBetween(a, b),
    latestPlayedAtBefore: (t) => inner.latestPlayedAtBefore(t),
    missingTrackIds: (n) => inner.missingTrackIds(n),
    incompleteArtistIds: (n) => inner.incompleteArtistIds(n),
    incompleteAlbumIds: (n) => inner.incompleteAlbumIds(n),
    trackDurations: (ids) => inner.trackDurations(ids),
    async markUnavailable(_kind, ids) {
      count("unavailable", ids.length);
    },
    async saveState() {
      count("state");
    },
    async insertPlays(rows) {
      count("insertPlays", rows.length);
      return rows.length;
    },
    async updatePlay() {
      count("updatePlay");
    },
    async upsertTracks(rows) {
      count("tracks", rows.length);
    },
    async upsertArtists(rows) {
      count("artists", rows.length);
    },
    async upsertAlbums(rows) {
      count("albums", rows.length);
    },
    async recordImport() {
      count("imports");
    },
  };
}
