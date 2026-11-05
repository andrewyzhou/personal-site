// pure mapping of spotify api objects onto the metadata cache rows

import type { SpotifyImage } from "../db/listening-schema";
import type { ApiAlbumLite, ApiArtistLite, ApiImage, ApiTrack } from "./normalize";

export interface TrackMeta {
  id: string;
  uri: string;
  name: string;
  durationMs: number | null;
  albumId: string | null;
  artistIds: string[];
  artistNames: string[];
  explicit: boolean | null;
  popularity: number | null;
  isrc: string | null;
  discNumber: number | null;
  trackNumber: number | null;
  isLocal: boolean | null;
  rawSha256: string | null;
  fetchedAt: Date;
  complete: boolean;
}

export interface ArtistMeta {
  id: string;
  uri: string;
  name: string;
  genres: string[] | null;
  popularity: number | null;
  followers: number | null;
  images: SpotifyImage[] | null;
  rawSha256: string | null;
  fetchedAt: Date;
  complete: boolean;
}

export interface AlbumMeta {
  id: string;
  uri: string;
  name: string;
  albumType: string | null;
  releaseDate: string | null;
  releaseDatePrecision: string | null;
  totalTracks: number | null;
  artistIds: string[];
  genres: string[] | null;
  label: string | null;
  popularity: number | null;
  images: SpotifyImage[] | null;
  rawSha256: string | null;
  fetchedAt: Date;
  complete: boolean;
}

export interface ApiArtistFull extends ApiArtistLite {
  genres?: string[];
  popularity?: number;
  followers?: { total?: number | null };
  images?: ApiImage[];
}

export interface ApiAlbumFull extends ApiAlbumLite {
  genres?: string[];
  label?: string;
  popularity?: number;
}

const images = (xs: ApiImage[] | undefined): SpotifyImage[] | null =>
  xs ? xs.map((i) => ({ url: i.url, width: i.width ?? null, height: i.height ?? null })) : null;

const n = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

// a full track object (recently-played embeds full tracks, /tracks returns them)
export function trackMeta(t: ApiTrack, rawSha256: string | null, fetchedAt: Date): TrackMeta | null {
  if (!t.id || t.type === "episode") return null;
  return {
    id: t.id,
    uri: t.uri,
    name: t.name,
    durationMs: n(t.duration_ms),
    albumId: t.album?.id ?? null,
    artistIds: (t.artists ?? []).map((a) => a.id).filter(Boolean),
    artistNames: (t.artists ?? []).map((a) => a.name),
    explicit: typeof t.explicit === "boolean" ? t.explicit : null,
    popularity: n(t.popularity),
    isrc: t.external_ids?.isrc ?? null,
    discNumber: n(t.disc_number),
    trackNumber: n(t.track_number),
    isLocal: typeof t.is_local === "boolean" ? t.is_local : null,
    rawSha256,
    fetchedAt,
    complete: true,
  };
}

export function artistMeta(a: ApiArtistFull, rawSha256: string | null, fetchedAt: Date, complete: boolean): ArtistMeta | null {
  if (!a?.id) return null;
  return {
    id: a.id,
    uri: a.uri ?? `spotify:artist:${a.id}`,
    name: a.name,
    genres: complete ? (a.genres ?? []) : null,
    popularity: complete ? n(a.popularity) : null,
    followers: complete ? n(a.followers?.total) : null,
    images: complete ? images(a.images) : null,
    rawSha256,
    fetchedAt,
    complete,
  };
}

export function albumMeta(a: ApiAlbumFull, rawSha256: string | null, fetchedAt: Date, complete: boolean): AlbumMeta | null {
  if (!a?.id) return null;
  return {
    id: a.id,
    uri: a.uri ?? `spotify:album:${a.id}`,
    name: a.name,
    albumType: a.album_type ?? null,
    releaseDate: a.release_date ?? null,
    releaseDatePrecision: a.release_date_precision ?? null,
    totalTracks: n(a.total_tracks),
    artistIds: (a.artists ?? []).map((x) => x.id).filter(Boolean),
    genres: complete ? (a.genres ?? []) : null,
    label: complete ? (a.label ?? null) : null,
    popularity: complete ? n(a.popularity) : null,
    images: images(a.images),
    rawSha256,
    fetchedAt,
    complete,
  };
}

// everything a full track object tells us: the track (complete) plus stub
// album/artist rows (simplified objects, filled later by a lookup)
export function metaFromTrack(
  t: ApiTrack,
  rawSha256: string | null,
  fetchedAt: Date
): { track: TrackMeta | null; albums: AlbumMeta[]; artists: ArtistMeta[] } {
  const track = trackMeta(t, rawSha256, fetchedAt);
  const albums: AlbumMeta[] = [];
  const artists: ArtistMeta[] = [];
  if (!track) return { track, albums, artists };
  if (t.album) {
    const al = albumMeta(t.album, rawSha256, fetchedAt, false);
    if (al) albums.push(al);
    for (const a of t.album.artists ?? []) {
      const am = artistMeta(a, rawSha256, fetchedAt, false);
      if (am) artists.push(am);
    }
  }
  for (const a of t.artists ?? []) {
    const am = artistMeta(a, rawSha256, fetchedAt, false);
    if (am) artists.push(am);
  }
  return { track, albums, artists };
}
