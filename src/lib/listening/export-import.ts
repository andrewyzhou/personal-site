// spotify data export import (extended streaming history and/or the basic
// account data zip). raw first: the whole zip and every history file go to the
// raw store as exact bytes; rows link to the file + index they came from.
// idempotent: rows carry an export dedupe key, so a re-run inserts nothing.

import { sha256Hex } from "../raw-store";
import {
  BASIC_MATCH_TOLERANCE_MS,
  EXTENDED_MATCH_TOLERANCE_MS,
  estimateMsPlayed,
  exportPatchForApiRow,
  matchPlays,
} from "./merge";
import {
  BASIC_FIELDS,
  EXTENDED_FIELDS,
  playFromBasic,
  playFromExtended,
  startedAtFor,
  type PlayDraft,
} from "./normalize";
import type { ListeningRepo, PlayRecord } from "./repo";

export type ExportFileKind = "extended" | "basic" | "other";

export function classifyExportPath(path: string): ExportFileKind {
  const base = path.split("/").pop() ?? path;
  if (/^Streaming_History_(Audio|Video)_.*\.json$/i.test(base) || /^endsong_\d+\.json$/i.test(base)) return "extended";
  if (/^StreamingHistory(_music|_podcast)?_?\d+\.json$/i.test(base)) return "basic";
  return "other";
}

export interface ExportFile {
  path: string;
  kind: ExportFileKind;
  sha256: string;
  size: number;
  rows: number;
  bytes: Uint8Array;
}

export interface ParsedExport {
  files: ExportFile[];
  drafts: PlayDraft[];
  invalidRows: number;
  unknownFields: Record<string, number>;
  // basic rows dropped because the extended history in the same zip has them
  redundantBasic: number;
  duplicateRows: number;
}

const decoder = new TextDecoder();

export function parseExportEntries(entries: { path: string; bytes: Uint8Array }[]): ParsedExport {
  const files: ExportFile[] = [];
  const extended: PlayDraft[] = [];
  const basic: PlayDraft[] = [];
  let invalidRows = 0;
  const unknown: Record<string, number> = {};
  const known = { extended: new Set<string>(EXTENDED_FIELDS), basic: new Set<string>(BASIC_FIELDS) };

  const sorted = [...entries].filter((e) => !e.path.endsWith("/")).sort((a, b) => a.path.localeCompare(b.path));
  for (const e of sorted) {
    const kind = classifyExportPath(e.path);
    const sha256 = sha256Hex(e.bytes);
    const file: ExportFile = { path: e.path, kind, sha256, size: e.bytes.length, rows: 0, bytes: e.bytes };
    files.push(file);
    if (kind === "other") continue;
    let rows: unknown;
    try {
      rows = JSON.parse(decoder.decode(e.bytes));
    } catch {
      throw new Error(`${e.path} is not valid json`);
    }
    if (!Array.isArray(rows)) throw new Error(`${e.path} is not a json array`);
    file.rows = rows.length;
    rows.forEach((row, i) => {
      if (!row || typeof row !== "object") {
        invalidRows++;
        return;
      }
      for (const k of Object.keys(row)) if (!known[kind].has(k)) unknown[`${kind}.${k}`] = (unknown[`${kind}.${k}`] ?? 0) + 1;
      const d =
        kind === "extended"
          ? playFromExtended(row as Record<string, unknown>, sha256, i)
          : playFromBasic(row as Record<string, unknown>, sha256, i);
      if (!d) invalidRows++;
      else (kind === "extended" ? extended : basic).push(d);
    });
  }

  // identical rows twice (a file repeated across export folders) → once
  let duplicateRows = 0;
  const seen = new Set<string>();
  const uniq = (xs: PlayDraft[]) =>
    xs.filter((d) => {
      if (seen.has(d.exportDedupeKey!)) {
        duplicateRows++;
        return false;
      }
      seen.add(d.exportDedupeKey!);
      return true;
    });
  const ext = uniq(extended);
  let bas = uniq(basic);

  // the extended history is a superset of the basic one: drop basic rows it covers
  let redundantBasic = 0;
  if (ext.length > 0 && bas.length > 0) {
    const pseudo = ext.map((d, i) => ({
      id: i,
      playedAt: d.playedAt,
      source: d.source,
      trackUri: null,
      episodeUri: null,
      trackName: d.trackName,
      artistName: d.artistName,
      episodeName: d.episodeName,
      showName: d.showName,
      apiDedupeKey: null,
      exportDedupeKey: null,
      msPlayed: d.msPlayed,
      msPlayedEstimated: false,
    }));
    const matches = matchPlays(pseudo, bas, { kind: "export", toleranceMs: BASIC_MATCH_TOLERANCE_MS });
    const drop = new Set(matches.map((m) => m.incomingIndex));
    redundantBasic = drop.size;
    bas = bas.filter((_, i) => !drop.has(i));
  }

  const drafts = [...ext, ...bas].sort((a, b) => a.playedAt.getTime() - b.playedAt.getTime());
  return { files, drafts, invalidRows, unknownFields: unknown, redundantBasic, duplicateRows };
}

export interface ImportSummary {
  zip: { sha256: string; size: number; filename: string | null };
  files: { path: string; kind: ExportFileKind; sha256: string; size: number; rows: number }[];
  plays: number;
  byKind: { extended: number; basic: number };
  range: { from: string | null; to: string | null };
  inserted: number;
  mergedWithApi: number;
  alreadyImported: number;
  redundantBasic: number;
  duplicateRows: number;
  invalidRows: number;
  reestimated: number;
  unknownFields: Record<string, number>;
  msPlayed: number;
  dryRun: boolean;
}

export interface ImportRaw {
  put(bytes: Uint8Array, opts: { kind: "spotify-export-zip" | "spotify-export-file"; contentType: string; filename: string; metadata: Record<string, unknown> }): Promise<string>;
}

const YEAR_MS = 366 * 24 * 3600 * 1000;
// an estimate only changes when the gap is shorter than the track, so an hour
// past the batch covers any row whose previous play is in it
const REESTIMATE_LOOKAHEAD_MS = 3600 * 1000;

// applies a parsed export: raw first, then merge onto api rows / insert, a
// year-sized window at a time so a decade of history never sits in memory twice
export async function importExport(opts: {
  zipBytes: Uint8Array;
  zipFilename: string | null;
  parsed: ParsedExport;
  repo: ListeningRepo;
  raw: ImportRaw;
  dryRun: boolean;
}): Promise<ImportSummary> {
  const { parsed, repo } = opts;
  const zipSha = await opts.raw.put(opts.zipBytes, {
    kind: "spotify-export-zip",
    contentType: "application/zip",
    filename: opts.zipFilename ?? "spotify-export.zip",
    metadata: { files: parsed.files.length },
  });
  for (const f of parsed.files) {
    if (f.kind === "other") continue;
    await opts.raw.put(f.bytes, {
      kind: "spotify-export-file",
      contentType: "application/json",
      filename: f.path.split("/").pop() ?? f.path,
      metadata: { zipSha256: zipSha, path: f.path, exportKind: f.kind },
    });
  }

  const s: ImportSummary = {
    zip: { sha256: zipSha, size: opts.zipBytes.length, filename: opts.zipFilename },
    files: parsed.files.map(({ path, kind, sha256, size, rows }) => ({ path, kind, sha256, size, rows })),
    plays: parsed.drafts.length,
    byKind: {
      extended: parsed.drafts.filter((d) => d.source === "export-extended").length,
      basic: parsed.drafts.filter((d) => d.source === "export-basic").length,
    },
    range: {
      from: parsed.drafts[0]?.playedAt.toISOString() ?? null,
      to: parsed.drafts.at(-1)?.playedAt.toISOString() ?? null,
    },
    inserted: 0,
    mergedWithApi: 0,
    alreadyImported: 0,
    redundantBasic: parsed.redundantBasic,
    duplicateRows: parsed.duplicateRows,
    invalidRows: parsed.invalidRows,
    reestimated: 0,
    unknownFields: parsed.unknownFields,
    msPlayed: parsed.drafts.reduce((a, d) => a + (d.msPlayed ?? 0), 0),
    dryRun: opts.dryRun,
  };

  let i = 0;
  const drafts = parsed.drafts;
  while (i < drafts.length) {
    const winStart = drafts[i].playedAt.getTime();
    let j = i;
    while (j < drafts.length && drafts[j].playedAt.getTime() < winStart + YEAR_MS) j++;
    const batch = drafts.slice(i, j);
    i = j;
    const from = new Date(winStart - BASIC_MATCH_TOLERANCE_MS);
    // reaches past the batch so api rows right after its last play (whose
    // previous play is now known) are re-estimated too
    const to = new Date(batch[batch.length - 1].playedAt.getTime() + REESTIMATE_LOOKAHEAD_MS);
    const existing = await repo.playsBetween(from, to);
    const knownKeys = new Set(existing.map((e) => e.exportDedupeKey).filter(Boolean));
    let pending = batch.filter((d) => {
      if (knownKeys.has(d.exportDedupeKey!)) {
        s.alreadyImported++;
        return false;
      }
      return true;
    });

    // api rows still waiting for their exact numbers
    const apiPool = existing.filter((e) => e.source === "api-recent" && !e.exportDedupeKey);
    for (const [source, tol] of [
      ["export-extended", EXTENDED_MATCH_TOLERANCE_MS],
      ["export-basic", BASIC_MATCH_TOLERANCE_MS],
    ] as const) {
      const group = pending.filter((d) => d.source === source);
      if (group.length === 0 || apiPool.length === 0) continue;
      const matches = matchPlays(apiPool, group, { kind: "export", toleranceMs: tol });
      const done = new Set<PlayDraft>();
      for (const m of matches) {
        const row = apiPool.find((e) => e.id === m.existingId)!;
        const patch = exportPatchForApiRow(row, group[m.incomingIndex]);
        await repo.updatePlay(row.id, patch);
        Object.assign(row, patch); // so the second pass can't reuse it
        done.add(group[m.incomingIndex]);
        s.mergedWithApi++;
      }
      pending = pending.filter((d) => !done.has(d));
    }

    if (pending.length > 0) s.inserted += await repo.insertPlays(pending);

    // estimates of api rows that are still estimated can only get better now
    // that the timeline around them is complete
    s.reestimated += await reestimate(repo, existing, pending, from);
  }

  if (!opts.dryRun) {
    await repo.recordImport({ zipSha256: zipSha, filename: opts.zipFilename, summary: { ...s } });
  }
  return s;
}


async function reestimate(repo: ListeningRepo, existing: PlayRecord[], inserted: PlayDraft[], from: Date): Promise<number> {
  const estimated = existing.filter((e) => e.source === "api-recent" && e.msPlayedEstimated && e.trackId);
  if (estimated.length === 0 || inserted.length === 0) return 0;
  const durations = await repo.trackDurations(estimated.map((e) => e.trackId!));
  const timeline = [
    ...existing.map((e) => ({
      playedAt: e.playedAt,
      durationMs: e.trackId ? (durations.get(e.trackId) ?? null) : null,
      needsEstimate: e.source === "api-recent" && e.msPlayedEstimated,
      row: e as PlayRecord | null,
    })),
    ...inserted.map((d) => ({ playedAt: d.playedAt, durationMs: null, needsEstimate: false, row: null })),
  ].sort((a, b) => a.playedAt.getTime() - b.playedAt.getTime());
  const prev = await repo.latestPlayedAtBefore(from);
  const est = estimateMsPlayed(timeline, prev);
  let n = 0;
  for (let k = 0; k < timeline.length; k++) {
    const row = timeline[k].row;
    const v = est[k];
    if (!row || v === null || v === row.msPlayed) continue;
    await repo.updatePlay(row.id, { msPlayed: v, msPlayedEstimated: true, startedAt: startedAtFor(row.playedAt, v) });
    n++;
  }
  return n;
}

