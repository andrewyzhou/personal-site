// neon implementation of ListeningRepo. server-only. single statements only
// (neon-http has no interactive transactions); every write is idempotent.

import { and, asc, desc, eq, gte, inArray, isNull, isNotNull, lt, lte, sql } from "drizzle-orm";
import {
  getDb,
  listeningAlbums,
  listeningArtists,
  listeningImports,
  listeningPlays,
  listeningSyncState,
  listeningTracks,
} from "../db";
import type { AlbumMeta, ArtistMeta, TrackMeta } from "./metadata";
import { STATE_ID, placeholderTrack, type ListeningRepo } from "./repo";

const CHUNK = 200;

function chunks<T>(xs: T[], n = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

function dedupeById<T extends { id: string; complete: boolean }>(rows: T[]): T[] {
  const m = new Map<string, T>();
  for (const r of rows) if (!m.has(r.id) || r.complete) m.set(r.id, r);
  return [...m.values()];
}

// the full column set of a cache row, for "replace with the newer lookup"
const setAll = <T extends Record<string, unknown>>(table: T, cols: string[]) =>
  Object.fromEntries(cols.map((c) => [c, sql.raw(`excluded.${(table[c] as { name: string }).name}`)]));

async function upsertMeta<R extends { id: string; complete: boolean }>(
  table: typeof listeningTracks | typeof listeningArtists | typeof listeningAlbums,
  rows: R[]
) {
  const db = getDb();
  const all = dedupeById(rows);
  const complete = all.filter((r) => r.complete);
  const stubs = all.filter((r) => !r.complete);
  const cols = Object.keys(all[0] ?? {}).filter((c) => c !== "id");
  for (const part of chunks(complete)) {
    await db
      .insert(table)
      .values(part as never)
      .onConflictDoUpdate({ target: table.id, set: setAll(table as never, cols) as never });
  }
  for (const part of chunks(stubs)) {
    await db.insert(table).values(part as never).onConflictDoNothing();
  }
}

export function dbListeningRepo(): ListeningRepo {
  return {
    async getState() {
      const rows = await getDb().select().from(listeningSyncState).where(eq(listeningSyncState.id, STATE_ID)).limit(1);
      return rows[0] ?? null;
    },
    async saveState(s) {
      const values = { ...s, updatedAt: new Date() };
      await getDb()
        .insert(listeningSyncState)
        .values({ id: STATE_ID, ...values })
        .onConflictDoUpdate({ target: listeningSyncState.id, set: values });
    },
    async playsBetween(from, to) {
      return getDb()
        .select()
        .from(listeningPlays)
        .where(and(gte(listeningPlays.playedAt, from), lte(listeningPlays.playedAt, to)))
        .orderBy(asc(listeningPlays.playedAt));
    },
    async latestPlayedAtBefore(t) {
      const rows = await getDb()
        .select({ playedAt: listeningPlays.playedAt })
        .from(listeningPlays)
        .where(lt(listeningPlays.playedAt, t))
        .orderBy(desc(listeningPlays.playedAt))
        .limit(1);
      return rows[0]?.playedAt ?? null;
    },
    async insertPlays(rows) {
      let n = 0;
      for (const part of chunks(rows)) {
        // no conflict target: either partial unique dedupe index makes it a no-op
        const out = await getDb().insert(listeningPlays).values(part).onConflictDoNothing().returning({ id: listeningPlays.id });
        n += out.length;
      }
      return n;
    },
    async updatePlay(id, patch) {
      await getDb()
        .update(listeningPlays)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(listeningPlays.id, id));
    },
    upsertTracks: (rows: TrackMeta[]) => upsertMeta(listeningTracks, rows),
    upsertArtists: (rows: ArtistMeta[]) => upsertMeta(listeningArtists, rows),
    upsertAlbums: (rows: AlbumMeta[]) => upsertMeta(listeningAlbums, rows),
    async missingTrackIds(limit) {
      const rows = await getDb()
        .selectDistinct({ id: listeningPlays.trackId })
        .from(listeningPlays)
        .leftJoin(listeningTracks, eq(listeningTracks.id, listeningPlays.trackId))
        .where(and(isNotNull(listeningPlays.trackId), isNull(listeningTracks.id)))
        .limit(limit);
      return rows.map((r) => r.id!).filter(Boolean);
    },
    async incompleteArtistIds(limit) {
      const rows = await getDb()
        .select({ id: listeningArtists.id })
        .from(listeningArtists)
        .where(eq(listeningArtists.complete, false))
        .limit(limit);
      return rows.map((r) => r.id);
    },
    async incompleteAlbumIds(limit) {
      const rows = await getDb()
        .select({ id: listeningAlbums.id })
        .from(listeningAlbums)
        .where(eq(listeningAlbums.complete, false))
        .limit(limit);
      return rows.map((r) => r.id);
    },
    async trackDurations(ids) {
      const m = new Map<string, number>();
      for (const part of chunks([...new Set(ids)], 500)) {
        const rows = await getDb()
          .select({ id: listeningTracks.id, d: listeningTracks.durationMs })
          .from(listeningTracks)
          .where(inArray(listeningTracks.id, part));
        for (const r of rows) if (r.d) m.set(r.id, r.d);
      }
      return m;
    },
    async markUnavailable(kind, ids, at) {
      if (ids.length === 0) return;
      if (kind === "tracks") {
        await getDb().insert(listeningTracks).values(ids.map((id) => placeholderTrack(id, at))).onConflictDoNothing();
      } else {
        const table = kind === "artists" ? listeningArtists : listeningAlbums;
        await getDb().update(table).set({ complete: true }).where(inArray(table.id, ids));
      }
    },
    async recordImport(row) {
      await getDb().insert(listeningImports).values(row);
    },
  };
}

// true once the listening migration has been applied
export async function listeningTablesExist(): Promise<boolean> {
  const res = await getDb().execute(sql`
    select count(*)::int as n from information_schema.tables
    where table_schema = 'public' and table_name in ('listening_plays', 'listening_sync_state')
  `);
  return Number((res.rows[0] as { n: number } | undefined)?.n ?? 0) === 2;
}
