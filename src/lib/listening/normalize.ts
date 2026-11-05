// pure parsing of spotify history sources into play rows. no io.
//
// timing: the api's played_at and the extended export's ts are both the moment
// playback of the item stopped (checked against live data: consecutive
// played_at gaps match the later track's duration). the basic export's endTime
// is the same instant floored to the minute. started_at = played_at − ms_played.

import type { ListeningItemType, ListeningPlayRow, ListeningSource } from "../db/listening-schema";

export type PlayDraft = Omit<ListeningPlayRow, "id" | "createdAt" | "updatedAt">;

// ---------------------------------------------------------------------------
// shared helpers

export function idFromUri(uri: string | null | undefined): string | null {
  if (!uri) return null;
  const m = /^spotify:(?:track|episode|audiobook|chapter|album|artist|playlist|show):([A-Za-z0-9]+)$/.exec(uri);
  return m ? m[1] : null;
}

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

// what the play was of, for cross-source matching: the item uri when known,
// else "name:<artist|show>|<track|episode>" (basic exports carry names only)
export function itemKey(p: {
  trackUri?: string | null;
  episodeUri?: string | null;
  audiobookChapterUri?: string | null;
  audiobookUri?: string | null;
  trackName?: string | null;
  artistName?: string | null;
  episodeName?: string | null;
  showName?: string | null;
}): string {
  const uri = p.trackUri ?? p.episodeUri ?? p.audiobookChapterUri ?? p.audiobookUri;
  if (uri) return uri;
  return nameKey(p);
}

export function nameKey(p: {
  trackName?: string | null;
  artistName?: string | null;
  episodeName?: string | null;
  showName?: string | null;
}): string {
  if (p.trackName || p.artistName) return `name:${norm(p.artistName)}|${norm(p.trackName)}`;
  return `name:${norm(p.showName)}|${norm(p.episodeName)}`;
}

export function startedAtFor(playedAt: Date, msPlayed: number | null | undefined): Date | null {
  if (msPlayed === null || msPlayed === undefined || !Number.isFinite(msPlayed)) return null;
  return new Date(playedAt.getTime() - msPlayed);
}

function emptyDraft(source: ListeningSource, playedAt: Date, itemType: ListeningItemType): PlayDraft {
  return {
    source,
    playedAt,
    startedAt: null,
    itemType,
    trackUri: null,
    trackId: null,
    trackName: null,
    artistName: null,
    albumName: null,
    episodeUri: null,
    episodeName: null,
    showName: null,
    audiobookUri: null,
    audiobookTitle: null,
    audiobookChapterUri: null,
    audiobookChapterTitle: null,
    msPlayed: null,
    msPlayedEstimated: false,
    skipped: null,
    reasonStart: null,
    reasonEnd: null,
    shuffle: null,
    offline: null,
    offlineTimestamp: null,
    incognito: null,
    platform: null,
    country: null,
    contextType: null,
    contextUri: null,
    apiRawSha256: null,
    apiRawIndex: null,
    exportRawSha256: null,
    exportRawIndex: null,
    apiDedupeKey: null,
    exportDedupeKey: null,
  };
}

// ---------------------------------------------------------------------------
// api: GET /v1/me/player/recently-played

export interface ApiArtistLite {
  id: string;
  name: string;
  uri?: string;
}
export interface ApiImage {
  url: string;
  width?: number | null;
  height?: number | null;
}
export interface ApiAlbumLite {
  id: string;
  name: string;
  uri?: string;
  album_type?: string;
  release_date?: string;
  release_date_precision?: string;
  total_tracks?: number;
  images?: ApiImage[];
  artists?: ApiArtistLite[];
}
export interface ApiTrack {
  id: string | null;
  uri: string;
  name: string;
  type?: string; // 'track' | 'episode'
  duration_ms?: number;
  explicit?: boolean;
  popularity?: number;
  is_local?: boolean;
  disc_number?: number;
  track_number?: number;
  external_ids?: { isrc?: string };
  album?: ApiAlbumLite;
  artists?: ApiArtistLite[];
  show?: { name?: string; uri?: string };
}
export interface ApiRecentItem {
  track: ApiTrack | null;
  played_at: string;
  context: { type?: string; uri?: string } | null;
}
export interface ApiRecentPage {
  items: ApiRecentItem[];
  next: string | null;
  cursors: { after?: string; before?: string } | null;
  limit?: number;
  href?: string;
}

export function apiDedupeKey(uri: string, playedAt: Date): string {
  return `api:${uri}@${playedAt.toISOString()}`;
}

// rawSha256 = the stored page the item came from; index = its position in it
export function playFromApiItem(item: ApiRecentItem, rawSha256: string | null, index: number): PlayDraft | null {
  const t = item.track;
  const playedAt = new Date(item.played_at);
  if (!t || !t.uri || Number.isNaN(playedAt.getTime())) return null;
  const isEpisode = t.type === "episode" || t.uri.startsWith("spotify:episode:");
  const d = emptyDraft("api-recent", playedAt, isEpisode ? "episode" : "track");
  if (isEpisode) {
    d.episodeUri = t.uri;
    d.episodeName = t.name;
    d.showName = t.show?.name ?? null;
  } else {
    d.trackUri = t.uri;
    d.trackId = t.id ?? idFromUri(t.uri);
    d.trackName = t.name;
    d.artistName = t.artists?.[0]?.name ?? null;
    d.albumName = t.album?.name ?? null;
  }
  d.contextType = item.context?.type ?? null;
  d.contextUri = item.context?.uri ?? null;
  d.apiRawSha256 = rawSha256;
  d.apiRawIndex = index;
  d.apiDedupeKey = apiDedupeKey(t.uri, playedAt);
  return d;
}

// ---------------------------------------------------------------------------
// extended streaming history (Streaming_History_Audio_*.json / _Video_*.json,
// older exports: endsong_*.json). documented fields:

export const EXTENDED_FIELDS = [
  "ts",
  "username",
  "platform",
  "ms_played",
  "conn_country",
  "ip_addr",
  "ip_addr_decrypted",
  "user_agent_decrypted",
  "master_metadata_track_name",
  "master_metadata_album_artist_name",
  "master_metadata_album_album_name",
  "spotify_track_uri",
  "episode_name",
  "episode_show_name",
  "spotify_episode_uri",
  "audiobook_title",
  "audiobook_uri",
  "audiobook_chapter_uri",
  "audiobook_chapter_title",
  "reason_start",
  "reason_end",
  "shuffle",
  "skipped",
  "offline",
  "offline_timestamp",
  "incognito_mode",
] as const;

const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const bool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : v === 1 ? true : v === 0 ? false : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function extendedDedupeKey(item: string, playedAt: Date, msPlayed: number): string {
  return `ext:${item}@${playedAt.toISOString()}:${msPlayed}`;
}

export function playFromExtended(
  e: Record<string, unknown>,
  rawSha256: string | null,
  index: number
): PlayDraft | null {
  const tsv = str(e.ts);
  const playedAt = tsv ? new Date(tsv) : null;
  const ms = num(e.ms_played);
  if (!playedAt || Number.isNaN(playedAt.getTime()) || ms === null) return null;
  const trackUri = str(e.spotify_track_uri);
  const episodeUri = str(e.spotify_episode_uri);
  const audiobookUri = str(e.audiobook_uri);
  const chapterUri = str(e.audiobook_chapter_uri);
  const itemType: ListeningItemType = trackUri
    ? "track"
    : episodeUri
      ? "episode"
      : audiobookUri || chapterUri
        ? "audiobook"
        : "unknown";
  const d = emptyDraft("export-extended", playedAt, itemType);
  d.trackUri = trackUri;
  d.trackId = idFromUri(trackUri);
  d.trackName = str(e.master_metadata_track_name);
  d.artistName = str(e.master_metadata_album_artist_name);
  d.albumName = str(e.master_metadata_album_album_name);
  d.episodeUri = episodeUri;
  d.episodeName = str(e.episode_name);
  d.showName = str(e.episode_show_name);
  d.audiobookUri = audiobookUri;
  d.audiobookTitle = str(e.audiobook_title);
  d.audiobookChapterUri = chapterUri;
  d.audiobookChapterTitle = str(e.audiobook_chapter_title);
  d.msPlayed = Math.round(ms);
  d.startedAt = startedAtFor(playedAt, d.msPlayed);
  d.skipped = bool(e.skipped);
  d.reasonStart = str(e.reason_start);
  d.reasonEnd = str(e.reason_end);
  d.shuffle = bool(e.shuffle);
  d.offline = bool(e.offline);
  d.offlineTimestamp = num(e.offline_timestamp);
  d.incognito = bool(e.incognito_mode);
  d.platform = str(e.platform);
  d.country = str(e.conn_country);
  d.exportRawSha256 = rawSha256;
  d.exportRawIndex = index;
  d.exportDedupeKey = extendedDedupeKey(itemKey(d), playedAt, d.msPlayed);
  return d;
}

// ---------------------------------------------------------------------------
// basic account data (StreamingHistory_music_N.json, StreamingHistory_podcast_N.json,
// older StreamingHistoryN.json): { endTime: "YYYY-MM-DD HH:MM" (utc), artistName,
// trackName, msPlayed } or { endTime, podcastName, episodeName, msPlayed }

export const BASIC_FIELDS = ["endTime", "artistName", "trackName", "podcastName", "episodeName", "msPlayed"] as const;

export function parseBasicEndTime(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s.trim());
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], m[6] ? +m[6] : 0));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function basicDedupeKey(item: string, playedAt: Date, msPlayed: number): string {
  return `basic:${item}@${playedAt.toISOString()}:${msPlayed}`;
}

export function playFromBasic(e: Record<string, unknown>, rawSha256: string | null, index: number): PlayDraft | null {
  const end = str(e.endTime);
  const playedAt = end ? parseBasicEndTime(end) : null;
  const ms = num(e.msPlayed);
  if (!playedAt || ms === null) return null;
  const isPodcast = str(e.podcastName) !== null || str(e.episodeName) !== null;
  const d = emptyDraft("export-basic", playedAt, isPodcast ? "episode" : "track");
  if (isPodcast) {
    d.showName = str(e.podcastName);
    d.episodeName = str(e.episodeName);
  } else {
    d.artistName = str(e.artistName);
    d.trackName = str(e.trackName);
  }
  d.msPlayed = Math.round(ms);
  d.startedAt = startedAtFor(playedAt, d.msPlayed);
  d.exportRawSha256 = rawSha256;
  d.exportRawIndex = index;
  d.exportDedupeKey = basicDedupeKey(nameKey(d), playedAt, d.msPlayed);
  return d;
}
