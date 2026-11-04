// pure helpers for ingesting a strava bulk export zip into the raw store
// (scripts/import-strava-export.mts). nothing here touches r2 or neon.

import type { RawKind } from "./raw-store";

export interface ExportEntryClass {
  kind: Extract<RawKind, "device-file" | "strava-export-file">;
  contentType: string;
}

const CONTENT_TYPES: [RegExp, string][] = [
  [/\.gz$/i, "application/gzip"],
  [/\.csv$/i, "text/csv"],
  [/\.json$/i, "application/json"],
  [/\.gpx$/i, "application/gpx+xml"],
  [/\.tcx$/i, "application/xml"],
  [/\.fit$/i, "application/octet-stream"],
  [/\.jpe?g$/i, "image/jpeg"],
  [/\.png$/i, "image/png"],
  [/\.heic$/i, "image/heic"],
  [/\.mp4$/i, "video/mp4"],
  [/\.mov$/i, "video/quicktime"],
];

export function exportContentType(path: string): string {
  for (const [re, type] of CONTENT_TYPES) if (re.test(path)) return type;
  return "application/octet-stream";
}

// activity originals live under activities/; everything else is kept as an
// opaque export file. null = not a file (directory entries, mac zip cruft)
export function classifyExportEntry(path: string): ExportEntryClass | null {
  if (path.endsWith("/") || path.startsWith("__MACOSX/") || /(^|\/)\.DS_Store$/.test(path)) return null;
  const kind = /^activities\/[^/]+$/.test(path) ? "device-file" : "strava-export-file";
  return { kind, contentType: exportContentType(path) };
}

// "C:\…\export_161887324.zip" → "export_161887324"
export function exportName(zipPath: string): string {
  const base = zipPath.slice(Math.max(zipPath.lastIndexOf("/"), zipPath.lastIndexOf("\\")) + 1);
  return base.replace(/\.zip$/i, "");
}

// ---------------------------------------------------------------------------
// activities.csv

export interface CsvActivityRef {
  stravaId: string;
  filename: string | null; // zip path, e.g. activities/123.fit.gz
  name: string;
  date: string;
}

// records as parsed without column mapping (the export repeats some headers,
// e.g. Distance / Elapsed Time, so name→value maps would lose columns)
export function csvActivityRefs(records: string[][]): CsvActivityRef[] {
  if (records.length === 0) return [];
  const header = records[0].map((h) => h.trim());
  const col = (name: string) => header.indexOf(name);
  const idCol = col("Activity ID");
  const fileCol = col("Filename");
  if (idCol < 0) throw new Error("activities.csv has no Activity ID column");
  const nameCol = col("Activity Name");
  const dateCol = col("Activity Date");
  const out: CsvActivityRef[] = [];
  for (const r of records.slice(1)) {
    const stravaId = (r[idCol] ?? "").trim();
    if (!/^\d+$/.test(stravaId)) continue;
    const filename = fileCol >= 0 ? (r[fileCol] ?? "").trim().replace(/\\/g, "/") : "";
    out.push({
      stravaId,
      filename: filename || null,
      name: nameCol >= 0 ? r[nameCol] ?? "" : "",
      date: dateCol >= 0 ? r[dateCol] ?? "" : "",
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// manifest

export interface ExportManifestEntry {
  path: string;
  sha256: string;
  size: number;
  kind: string;
}

export interface ExportManifest {
  export: string;
  fileCount: number;
  totalBytes: number;
  entries: ExportManifestEntry[];
}

// deterministic (sorted, no timestamps) so re-runs hash to the same raw object
export function buildExportManifest(name: string, entries: ExportManifestEntry[]): { manifest: ExportManifest; bytes: Uint8Array } {
  const sorted = [...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const manifest: ExportManifest = {
    export: name,
    fileCount: sorted.length,
    totalBytes: sorted.reduce((s, e) => s + e.size, 0),
    entries: sorted.map((e) => ({ path: e.path, sha256: e.sha256, size: e.size, kind: e.kind })),
  };
  return { manifest, bytes: new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`) };
}

// ---------------------------------------------------------------------------
// matching csv rows to activities

export interface AttachPlanItem {
  activityId: number;
  stravaId: string;
  path: string;
  sha256: string; // exact archive bytes (the .gz container, not unwrapped)
  via: "source" | "legacy";
  existing: boolean; // the device-file source row is already there
}

export interface AttachPlan {
  attach: AttachPlanItem[];
  notInDb: CsvActivityRef[]; // csv rows with no matching activity
  missingFile: CsvActivityRef[]; // csv Filename not present in the zip
  noFile: CsvActivityRef[]; // csv rows without a Filename
}

export interface AttachLookup {
  // strava id → activity id via activity_sources (provider 'strava')
  bySource: Map<string, number>;
  // strava id → activity id via legacy activities.external_id (strava-ish rows)
  byLegacy: Map<string, number>;
  // zip path → sha256 of the exact entry bytes
  entryShas: Map<string, string>;
  // `${activityId}:${sha256}` for device-file sources already present
  existingDeviceFiles: Set<string>;
}

export function deviceFileKey(activityId: number, sha256: string): string {
  return `${activityId}:${sha256}`;
}

export function planAttachments(refs: CsvActivityRef[], lookup: AttachLookup): AttachPlan {
  const plan: AttachPlan = { attach: [], notInDb: [], missingFile: [], noFile: [] };
  for (const ref of refs) {
    const fromSource = lookup.bySource.get(ref.stravaId);
    const fromLegacy = lookup.byLegacy.get(ref.stravaId);
    const activityId = fromSource ?? fromLegacy;
    if (activityId === undefined) {
      plan.notInDb.push(ref);
      continue;
    }
    if (!ref.filename) {
      plan.noFile.push(ref);
      continue;
    }
    const sha256 = lookup.entryShas.get(ref.filename);
    if (!sha256) {
      plan.missingFile.push(ref);
      continue;
    }
    plan.attach.push({
      activityId,
      stravaId: ref.stravaId,
      path: ref.filename,
      sha256,
      via: fromSource !== undefined ? "source" : "legacy",
      existing: lookup.existingDeviceFiles.has(deviceFileKey(activityId, sha256)),
    });
  }
  return plan;
}

// db strava ids the export doesn't know about (e.g. synced after the export)
export function stravaIdsNotInCsv(dbStravaIds: Iterable<string>, refs: CsvActivityRef[]): string[] {
  const inCsv = new Set(refs.map((r) => r.stravaId));
  return [...new Set(dbStravaIds)].filter((id) => !inCsv.has(id)).sort();
}
