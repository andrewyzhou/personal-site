// republish against a pre-migration database: synthesizes the v2 sources/edits
// from the legacy columns exactly like drizzle/0003_activities_v2_backfill.sql
// would, so a dry run can prove republish reproduces the legacy output before
// anything is migrated. read-only by construction: every write dep throws.

import { getTableColumns } from "drizzle-orm";
import { activities, type ActivityRow } from "./db/schema";
import { legacyProvider } from "./legacy-sources";
import type { EditInput, PublicColumns, RepublishDeps, RepublishResult, SourceInput, ZoneInput } from "./republish";

// columns that exist before migrations 0002/0003 (processing_version,
// published_inputs_hash, canonical_track_key are added by 0002)
export type LegacyActivityRow = Omit<ActivityRow, "processingVersion" | "publishedInputsHash" | "canonicalTrackKey">;

// explicit select list for db.select(...): never names a v2 column
export function legacyActivityColumns() {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { processingVersion, publishedInputsHash, canonicalTrackKey, ...legacy } = getTableColumns(activities);
  return legacy;
}

// the prod activities columns before 0002 (checked against the schema in tests)
export const LEGACY_ACTIVITY_COLUMN_NAMES = [
  "id", "name", "sport_type", "start_date_utc", "local_date", "local_time", "utc_offset_min",
  "distance_m", "moving_time_s", "elapsed_time_s", "elev_gain_m", "avg_speed_ms", "max_speed_ms",
  "avg_hr", "max_hr", "avg_cadence", "avg_watts", "max_watts", "kilojoules", "description",
  "suffer_score", "gear", "polyline", "card_polyline", "bounds", "trim_start_m", "trim_end_m",
  "fit_blob_url", "fit_blob_pathname", "fit_sha256", "file_type", "source", "external_id",
  "dedupe_key", "hidden", "created_at", "updated_at",
] as const;

// one source per activity; the id is synthetic (only ordering within a kind and
// the inputs hash use it, and a legacy row has exactly one source)
export function legacySources(row: Pick<LegacyActivityRow, "id" | "source" | "externalId" | "fitSha256">): SourceInput[] {
  return [
    {
      id: 1,
      provider: legacyProvider(row.source),
      externalId: row.externalId ?? null,
      kind: row.fitSha256 ? "device-file" : "summary",
      rawSha256: row.fitSha256 ?? null,
    },
  ];
}

// the current trim becomes an explicit edit for every activity with a route or
// an original (legacy imports trimmed gps-less files too)
export function legacyEdits(row: Pick<LegacyActivityRow, "polyline" | "fitSha256" | "trimStartM" | "trimEndM">): EditInput[] {
  if (!row.polyline && !row.fitSha256) return [];
  return [{ id: 1, kind: "trim", params: { startM: row.trimStartM, endM: row.trimEndM } }];
}

// pre-migration rows look like never-republished ones
export function toActivityRow(row: LegacyActivityRow): ActivityRow {
  return { ...row, processingVersion: 0, publishedInputsHash: null, canonicalTrackKey: null };
}

export function legacyDeps(io: {
  loadLegacyRow(id: number): Promise<LegacyActivityRow | null>;
  loadRaw(sha256: string, row: ActivityRow): Promise<Uint8Array | null>;
  zones?: ZoneInput[]; // privacy_zones doesn't exist yet: none
}): RepublishDeps {
  const cache = new Map<number, Promise<LegacyActivityRow | null>>();
  const load = (id: number) => {
    if (!cache.has(id)) cache.set(id, io.loadLegacyRow(id));
    return cache.get(id)!;
  };
  const refuse = () => Promise.reject(new Error("legacy republish deps are read-only"));
  return {
    async loadActivity(id) {
      const row = await load(id);
      return row ? toActivityRow(row) : null;
    },
    async loadSources(id) {
      const row = await load(id);
      return row ? legacySources(row) : [];
    },
    async loadEdits(id) {
      const row = await load(id);
      return row ? legacyEdits(row) : [];
    },
    async loadZones() {
      return io.zones ?? [];
    },
    loadRaw: io.loadRaw,
    storeDerived: refuse,
    writeColumns: refuse,
  };
}

// ---------------------------------------------------------------------------
// change summary for bulk dry runs

export interface ChangeExample {
  id: number;
  old: string;
  new: string;
}

export interface ChangeSummary {
  statuses: Record<string, number>;
  errors: { id: number; error: string }[];
  changedActivities: number; // would-publish/published with ≥1 changed column
  unchangedActivities: number; // would-publish/published reproducing the row exactly
  columns: Record<string, { count: number; examples: ChangeExample[] }>;
  byTrackKind: Record<string, number>;
}

export function emptySummary(): ChangeSummary {
  return { statuses: {}, errors: [], changedActivities: 0, unchangedActivities: 0, columns: {}, byTrackKind: {} };
}

// short, comparable rendering of a column value (polylines are long)
export function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  if (typeof v === "string") return v.length > 24 ? `"${v.slice(0, 12)}…" (${v.length} chars)` : JSON.stringify(v);
  if (typeof v === "object") {
    const s = JSON.stringify(v, (_k, x) => (typeof x === "number" && !Number.isInteger(x) ? Number(x.toFixed(5)) : x));
    return s.length > 80 ? `${s.slice(0, 77)}…` : s;
  }
  return String(v);
}

export function recordResult(
  summary: ChangeSummary,
  result: RepublishResult,
  row: Partial<ActivityRow> | null,
  maxExamples = 3
): void {
  summary.statuses[result.status] = (summary.statuses[result.status] ?? 0) + 1;
  if (result.status !== "would-publish" && result.status !== "published") return;
  summary.byTrackKind[result.track.kind] = (summary.byTrackKind[result.track.kind] ?? 0) + 1;
  if (result.changed.length === 0) summary.unchangedActivities++;
  else summary.changedActivities++;
  for (const col of result.changed) {
    const entry = (summary.columns[col] ??= { count: 0, examples: [] });
    entry.count++;
    if (entry.examples.length < maxExamples) {
      entry.examples.push({
        id: result.id,
        old: formatValue(row?.[col as keyof ActivityRow]),
        new: formatValue(result.columns[col as keyof PublicColumns]),
      });
    }
  }
}

export function recordError(summary: ChangeSummary, id: number, error: unknown): void {
  summary.statuses.error = (summary.statuses.error ?? 0) + 1;
  summary.errors.push({ id, error: error instanceof Error ? error.message : String(error) });
}
