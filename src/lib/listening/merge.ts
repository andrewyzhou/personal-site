// pure dedupe / merge / estimate logic for plays coming from more than one
// source. no io.

import { itemKey, nameKey, startedAtFor, type PlayDraft } from "./normalize";

// api played_at and the extended export's ts are the same instant at different
// precision (ms vs s); offline plays can drift a little more
export const EXTENDED_MATCH_TOLERANCE_MS = 15_000;
// the basic export floors endTime to the minute
export const BASIC_MATCH_TOLERANCE_MS = 75_000;

export interface ExistingPlay {
  id: number;
  playedAt: Date;
  source: PlayDraft["source"];
  trackUri: string | null;
  episodeUri: string | null;
  audiobookUri?: string | null;
  audiobookChapterUri?: string | null;
  trackName: string | null;
  artistName: string | null;
  episodeName: string | null;
  showName: string | null;
  apiDedupeKey: string | null;
  exportDedupeKey: string | null;
  msPlayed: number | null;
  msPlayedEstimated: boolean;
}

export interface Match {
  existingId: number;
  incomingIndex: number;
  deltaMs: number;
}

function keysOf(p: Parameters<typeof itemKey>[0]): { item: string; name: string } {
  return { item: itemKey(p), name: nameKey(p) };
}

// one-to-one pairing of incoming drafts with existing rows of the other kind:
// same item (uri, or artist+track names when the incoming side has no uri),
// played_at within the tolerance, closest pairs first. an existing row that
// already carries the incoming kind's key is never a candidate.
export function matchPlays(
  existing: ExistingPlay[],
  incoming: PlayDraft[],
  opts: { kind: "api" | "export"; toleranceMs: number }
): Match[] {
  const byKey = new Map<string, ExistingPlay[]>();
  const add = (k: string, e: ExistingPlay) => {
    const list = byKey.get(k);
    if (list) list.push(e);
    else byKey.set(k, [e]);
  };
  for (const e of existing) {
    if (opts.kind === "api" ? e.apiDedupeKey : e.exportDedupeKey) continue;
    const k = keysOf(e);
    add(k.item, e);
    if (k.name !== k.item) add(k.name, e);
  }

  const candidates: Match[] = [];
  incoming.forEach((p, i) => {
    const k = keysOf(p);
    // with a uri, match on it (and on names against rows that have no uri,
    // e.g. basic export rows); names only when the incoming side has none
    const pool = k.item.startsWith("name:")
      ? (byKey.get(k.name) ?? [])
      : [...(byKey.get(k.item) ?? []), ...(byKey.get(k.name) ?? []).filter((e) => itemKey(e).startsWith("name:"))];
    const seen = new Set<number>();
    for (const e of pool) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      const delta = Math.abs(e.playedAt.getTime() - p.playedAt.getTime());
      if (delta <= opts.toleranceMs) candidates.push({ existingId: e.id, incomingIndex: i, deltaMs: delta });
    }
  });
  candidates.sort((a, b) => a.deltaMs - b.deltaMs || a.existingId - b.existingId || a.incomingIndex - b.incomingIndex);
  const usedE = new Set<number>();
  const usedI = new Set<number>();
  const out: Match[] = [];
  for (const c of candidates) {
    if (usedE.has(c.existingId) || usedI.has(c.incomingIndex)) continue;
    usedE.add(c.existingId);
    usedI.add(c.incomingIndex);
    out.push(c);
  }
  return out.sort((a, b) => a.incomingIndex - b.incomingIndex);
}

const pick = <T>(a: T | null | undefined, b: T | null | undefined): T | null => (a ?? b ?? null) as T | null;

// export fields onto an api row. the export wins for everything it measures
// exactly (ms_played, skip, reasons, flags, platform, country); the api row
// keeps its ms-precision played_at, context and api links.
export function exportPatchForApiRow(api: ExistingPlay & Partial<PlayDraft>, exp: PlayDraft): Partial<PlayDraft> {
  const playedAt = api.playedAt;
  return {
    source: exp.source,
    itemType: exp.itemType !== "unknown" ? exp.itemType : api.itemType,
    trackUri: pick(api.trackUri, exp.trackUri),
    trackId: pick(api.trackId, exp.trackId),
    trackName: pick(exp.trackName, api.trackName),
    artistName: pick(exp.artistName, api.artistName),
    albumName: pick(exp.albumName, api.albumName),
    episodeUri: pick(api.episodeUri, exp.episodeUri),
    episodeName: pick(exp.episodeName, api.episodeName),
    showName: pick(exp.showName, api.showName),
    audiobookUri: pick(exp.audiobookUri, api.audiobookUri),
    audiobookTitle: pick(exp.audiobookTitle, api.audiobookTitle),
    audiobookChapterUri: pick(exp.audiobookChapterUri, api.audiobookChapterUri),
    audiobookChapterTitle: pick(exp.audiobookChapterTitle, api.audiobookChapterTitle),
    msPlayed: exp.msPlayed,
    msPlayedEstimated: false,
    startedAt: startedAtFor(playedAt, exp.msPlayed),
    skipped: exp.skipped,
    reasonStart: exp.reasonStart,
    reasonEnd: exp.reasonEnd,
    shuffle: exp.shuffle,
    offline: exp.offline,
    offlineTimestamp: exp.offlineTimestamp,
    incognito: exp.incognito,
    platform: exp.platform,
    country: exp.country,
    exportRawSha256: exp.exportRawSha256,
    exportRawIndex: exp.exportRawIndex,
    exportDedupeKey: exp.exportDedupeKey,
  };
}

// api fields onto an export row: context, links, and the uri a basic export lacks.
// play-level measurements stay the export's.
export function apiPatchForExportRow(exp: ExistingPlay & Partial<PlayDraft>, api: PlayDraft): Partial<PlayDraft> {
  return {
    trackUri: pick(exp.trackUri, api.trackUri),
    trackId: pick(exp.trackId, api.trackId),
    episodeUri: pick(exp.episodeUri, api.episodeUri),
    albumName: pick(exp.albumName, api.albumName),
    itemType: exp.itemType && exp.itemType !== "unknown" ? exp.itemType : api.itemType,
    contextType: api.contextType,
    contextUri: api.contextUri,
    apiRawSha256: api.apiRawSha256,
    apiRawIndex: api.apiRawIndex,
    apiDedupeKey: api.apiDedupeKey,
  };
}

// estimated ms_played for api plays. played_at is when an item stopped, so an
// item can have played at most from the previous play's played_at to its own;
// capped at the track duration. `prev` is the latest stored play before the
// first one given (any source). returns one value per play (null = leave as is:
// the play is exact, or nothing to estimate from).
export interface EstimateInput {
  playedAt: Date;
  durationMs: number | null;
  needsEstimate: boolean; // false for rows with an exact ms_played
}

export function estimateMsPlayed(plays: EstimateInput[], prev: Date | null): (number | null)[] {
  const out: (number | null)[] = [];
  let last = prev ? prev.getTime() : null;
  for (const p of plays) {
    const t = p.playedAt.getTime();
    if (!p.needsEstimate || p.durationMs === null || p.durationMs <= 0) {
      out.push(null);
    } else {
      const gap = last === null ? p.durationMs : Math.max(0, t - last);
      out.push(Math.min(p.durationMs, gap));
    }
    last = last === null ? t : Math.max(last, t);
  }
  return out;
}

export function sortByPlayedAt<T extends { playedAt: Date }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.playedAt.getTime() - b.playedAt.getTime());
}
