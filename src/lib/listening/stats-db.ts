// loads plays (+ track/artist metadata) into the shape the pure stats take.
// read-only, server-only, private: none of this feeds a public page yet.

import { and, asc, gte, inArray, lt } from "drizzle-orm";
import { activities, getDb, listeningArtists, listeningPlays, listeningTracks } from "../db";
import {
  DEFAULT_LISTENING_TIMEZONE,
  listeningByDay,
  playsDuringActivities,
  type ActivityListening,
  type ListeningDay,
  type StatPlay,
} from "./stats";

export function toStatPlay(
  p: {
    playedAt: Date;
    startedAt: Date | null;
    msPlayed: number | null;
    skipped: boolean | null;
    itemType: string;
    trackId: string | null;
    trackName: string | null;
    artistName: string | null;
    albumName: string | null;
    showName?: string | null;
    episodeName?: string | null;
  },
  track: { name: string; artistIds: string[]; artistNames: string[]; albumId: string | null } | undefined,
  genresByArtist: Map<string, string[]>
): StatPlay {
  const artistIds = track?.artistIds ?? [];
  const artistNames = track?.artistNames?.length ? track.artistNames : p.artistName ? [p.artistName] : p.showName ? [p.showName] : [];
  const genres = [...new Set(artistIds.flatMap((id) => genresByArtist.get(id) ?? []))];
  return {
    playedAt: p.playedAt,
    startedAt: p.startedAt,
    msPlayed: p.msPlayed,
    skipped: p.skipped,
    itemType: p.itemType,
    trackId: p.trackId,
    trackName: (track?.name || p.trackName) ?? p.episodeName ?? null,
    artistIds,
    artistNames,
    albumId: track?.albumId ?? null,
    albumName: p.albumName,
    genres,
  };
}

export async function loadStatPlays(range: { from?: Date; to?: Date } = {}): Promise<StatPlay[]> {
  const db = getDb();
  const conds = [];
  if (range.from) conds.push(gte(listeningPlays.playedAt, range.from));
  if (range.to) conds.push(lt(listeningPlays.playedAt, range.to));
  const plays = await db
    .select({
      playedAt: listeningPlays.playedAt,
      startedAt: listeningPlays.startedAt,
      msPlayed: listeningPlays.msPlayed,
      skipped: listeningPlays.skipped,
      itemType: listeningPlays.itemType,
      trackId: listeningPlays.trackId,
      trackName: listeningPlays.trackName,
      artistName: listeningPlays.artistName,
      albumName: listeningPlays.albumName,
      showName: listeningPlays.showName,
      episodeName: listeningPlays.episodeName,
    })
    .from(listeningPlays)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(listeningPlays.playedAt));

  const trackIds = [...new Set(plays.map((p) => p.trackId).filter((x): x is string => !!x))];
  const tracks = new Map<string, { name: string; artistIds: string[]; artistNames: string[]; albumId: string | null }>();
  for (let i = 0; i < trackIds.length; i += 1000) {
    const rows = await db
      .select({ id: listeningTracks.id, name: listeningTracks.name, artistIds: listeningTracks.artistIds, artistNames: listeningTracks.artistNames, albumId: listeningTracks.albumId })
      .from(listeningTracks)
      .where(inArray(listeningTracks.id, trackIds.slice(i, i + 1000)));
    for (const r of rows) tracks.set(r.id, r);
  }
  const artistIds = [...new Set([...tracks.values()].flatMap((t) => t.artistIds))];
  const genres = new Map<string, string[]>();
  for (let i = 0; i < artistIds.length; i += 1000) {
    const rows = await db
      .select({ id: listeningArtists.id, genres: listeningArtists.genres })
      .from(listeningArtists)
      .where(inArray(listeningArtists.id, artistIds.slice(i, i + 1000)));
    for (const r of rows) if (r.genres?.length) genres.set(r.id, r.genres);
  }
  return plays.map((p) => toStatPlay(p, p.trackId ? tracks.get(p.trackId) : undefined, genres));
}

// the per-day aggregate a calendar can show: [{ date, minutes, plays, topArtist }]
export async function loadListeningDays(from: Date, to: Date, timeZone = DEFAULT_LISTENING_TIMEZONE): Promise<ListeningDay[]> {
  // a day of margin so local days at the edges are whole
  const plays = await loadStatPlays({ from: new Date(from.getTime() - 86_400_000), to: new Date(to.getTime() + 86_400_000) });
  const lo = from.toISOString().slice(0, 10);
  const hi = to.toISOString().slice(0, 10);
  return listeningByDay(plays, timeZone).filter((d) => d.date >= lo && d.date <= hi);
}

// what played during each activity in the range. reads activities, never writes them.
export async function loadActivityListening(from: Date, to: Date): Promise<ActivityListening[]> {
  const acts = await getDb()
    .select({ id: activities.id, startDateUtc: activities.startDateUtc, elapsedTimeS: activities.elapsedTimeS, sportType: activities.sportType })
    .from(activities)
    .where(and(gte(activities.startDateUtc, from), lt(activities.startDateUtc, to)));
  if (acts.length === 0) return [];
  const longest = Math.max(...acts.map((a) => a.elapsedTimeS)) * 1000;
  const plays = await loadStatPlays({ from, to: new Date(to.getTime() + longest + 3_600_000) });
  return playsDuringActivities(plays, acts);
}
