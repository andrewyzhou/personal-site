// data for /admin/listening. read-only, server-only.

import { desc, eq, sql } from "drizzle-orm";
import { getDb, listeningImports, listeningPlays, listeningSyncState } from "../db";
import type { ListeningSyncStateRow } from "../db/listening-schema";
import { STATE_ID } from "./repo";
import { listeningTablesExist } from "./repo-db";

export interface RecentPlay {
  id: number;
  playedAt: string;
  source: string;
  itemType: string;
  title: string | null;
  artist: string | null;
  msPlayed: number | null;
  msPlayedEstimated: boolean;
  skipped: boolean | null;
  contextType: string | null;
}

export interface ListeningOverview {
  migrated: boolean;
  state: ListeningSyncStateRow | null;
  counts: {
    plays: number;
    bySource: Record<string, number>;
    estimated: number;
    hours: number;
    first: string | null;
    last: string | null;
    tracks: number;
    artists: number;
    artistsIncomplete: number;
    albums: number;
  } | null;
  recent: RecentPlay[];
  lastImport: { createdAt: string; filename: string | null; summary: Record<string, unknown> } | null;
}

export async function loadListeningOverview(limit = 50): Promise<ListeningOverview> {
  if (!(await listeningTablesExist())) return { migrated: false, state: null, counts: null, recent: [], lastImport: null };
  const db = getDb();
  const [stateRows, countRows, sourceRows, metaRows, recentRows, importRows] = await Promise.all([
    db.select().from(listeningSyncState).where(eq(listeningSyncState.id, STATE_ID)).limit(1),
    db.execute(sql`
      select count(*)::int as plays,
             count(*) filter (where ms_played_estimated)::int as estimated,
             coalesce(sum(ms_played), 0)::float8 as ms,
             min(played_at) as first, max(played_at) as last
      from listening_plays`),
    db.execute(sql`select source, count(*)::int as n from listening_plays group by source`),
    db.execute(sql`
      select (select count(*)::int from listening_tracks) as tracks,
             (select count(*)::int from listening_artists) as artists,
             (select count(*)::int from listening_artists where not complete) as artists_incomplete,
             (select count(*)::int from listening_albums) as albums`),
    db
      .select({
        id: listeningPlays.id,
        playedAt: listeningPlays.playedAt,
        source: listeningPlays.source,
        itemType: listeningPlays.itemType,
        trackName: listeningPlays.trackName,
        episodeName: listeningPlays.episodeName,
        audiobookTitle: listeningPlays.audiobookTitle,
        artistName: listeningPlays.artistName,
        showName: listeningPlays.showName,
        msPlayed: listeningPlays.msPlayed,
        msPlayedEstimated: listeningPlays.msPlayedEstimated,
        skipped: listeningPlays.skipped,
        contextType: listeningPlays.contextType,
      })
      .from(listeningPlays)
      .orderBy(desc(listeningPlays.playedAt))
      .limit(limit),
    db.select().from(listeningImports).orderBy(desc(listeningImports.createdAt)).limit(1),
  ]);
  const c = countRows.rows[0] as { plays: number; estimated: number; ms: number; first: string | null; last: string | null };
  const m = metaRows.rows[0] as { tracks: number; artists: number; artists_incomplete: number; albums: number };
  const iso = (v: string | Date | null) => (v ? new Date(v).toISOString() : null);
  return {
    migrated: true,
    state: stateRows[0] ?? null,
    counts: {
      plays: c.plays,
      bySource: Object.fromEntries((sourceRows.rows as { source: string; n: number }[]).map((r) => [r.source, r.n])),
      estimated: c.estimated,
      hours: Math.round((Number(c.ms) / 3.6e6) * 10) / 10,
      first: iso(c.first),
      last: iso(c.last),
      tracks: m.tracks,
      artists: m.artists,
      artistsIncomplete: m.artists_incomplete,
      albums: m.albums,
    },
    recent: recentRows.map((r) => ({
      id: r.id,
      playedAt: r.playedAt.toISOString(),
      source: r.source,
      itemType: r.itemType,
      title: r.trackName ?? r.episodeName ?? r.audiobookTitle,
      artist: r.artistName ?? r.showName,
      msPlayed: r.msPlayed,
      msPlayedEstimated: r.msPlayedEstimated,
      skipped: r.skipped,
      contextType: r.contextType,
    })),
    lastImport: importRows[0]
      ? { createdAt: importRows[0].createdAt.toISOString(), filename: importRows[0].filename, summary: importRows[0].summary }
      : null,
  };
}
