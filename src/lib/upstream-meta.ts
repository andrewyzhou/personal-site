// apply one upstream's metadata (name, description, type; hidden on delete)
// to an activity row, newest edit wins (metadata-merge.ts), and log each
// decision. shared by intervals.icu and the garmin personal api. server-only.

import { eq } from "drizzle-orm";
import { getDb, activities, type ActivityRow } from "./db";
import { addActivitySource, storeRawPayload, type SourceKind, type SourceProvider } from "./activity-sources";
import { invalidateCache } from "./cache";
import { mergeUpstreamMeta, type MergeResult, type UpstreamValues } from "./metadata-merge";
import { staleMark } from "./privacy/stale";
import { isDryRun, syncEvent } from "./sync-log";
import type { RawKind } from "./raw-store";

type MetaRow = Pick<ActivityRow, "id" | "name" | "description" | "sportType" | "hidden" | "metaEditedAt" | "upstreamMeta">;

export async function loadMetaRow(id: number): Promise<MetaRow | null> {
  const rows = await getDb()
    .select({
      id: activities.id,
      name: activities.name,
      description: activities.description,
      sportType: activities.sportType,
      hidden: activities.hidden,
      metaEditedAt: activities.metaEditedAt,
      upstreamMeta: activities.upstreamMeta,
    })
    .from(activities)
    .where(eq(activities.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export interface MetaOutcome {
  rowId: number | null;
  applied: MergeResult["applied"];
}

// "unchanged" is the steady state of every frequent pull: not worth a row
const QUIET_SKIPS = new Set(["unchanged"]);

// only this row: split halves keep their own names. a sport change marks the
// row stale (cleaning and metrics depend on it; the rebuild job republishes).
export async function applyUpstreamMeta(input: {
  row: MetaRow;
  provider: SourceProvider;
  source: string; // the sync-log source name
  externalId: string;
  upstream: UpstreamValues;
  changedAt?: Date | null;
  now?: Date;
  raw?: { bytes: Uint8Array; kind: RawKind & SourceKind };
}): Promise<MetaOutcome> {
  const { row, provider, source, externalId } = input;
  const now = input.now ?? new Date();
  const merged = mergeUpstreamMeta({
    current: { name: row.name, description: row.description, sportType: row.sportType, hidden: row.hidden },
    siteEdits: row.metaEditedAt,
    previous: row.upstreamMeta,
    upstream: input.upstream,
    provider,
    externalId,
    changedAt: input.changedAt ?? null,
    now,
  });
  const prev = row.upstreamMeta;
  const snapshotChanged =
    !prev ||
    prev.provider !== merged.snapshot.provider ||
    prev.externalId !== merged.snapshot.externalId ||
    prev.name !== merged.snapshot.name ||
    prev.description !== merged.snapshot.description ||
    prev.sportType !== merged.snapshot.sportType ||
    prev.hidden !== merged.snapshot.hidden;

  const site = row.metaEditedAt ?? {};
  for (const field of merged.applied) {
    const siteAt = site[field];
    await syncEvent({
      source,
      kind: "update_field",
      activityId: row.id,
      externalId,
      detail: {
        field,
        old: row[field],
        new: merged.updates[field],
        winner: provider,
        why: siteAt ? `upstream change is newer than the site edit at ${siteAt}` : "changed upstream, never edited on the site",
        ...(input.changedAt ? { changedAt: input.changedAt.toISOString() } : {}),
      },
    });
  }
  for (const s of merged.skipped) {
    if (QUIET_SKIPS.has(s.reason)) continue;
    await syncEvent({
      source,
      kind: "skip",
      activityId: row.id,
      externalId,
      detail: { field: s.field, reason: s.reason, upstream: merged.snapshot[s.field], current: row[s.field] },
    });
  }

  if (!snapshotChanged && merged.applied.length === 0) return { rowId: row.id, applied: [] };
  if (isDryRun()) return { rowId: row.id, applied: merged.applied };

  const sportChanged = merged.updates.sportType !== undefined && merged.updates.sportType !== row.sportType;
  await getDb()
    .update(activities)
    .set({
      ...merged.updates,
      ...(sportChanged ? staleMark() : {}),
      upstreamMeta: merged.snapshot,
      updatedAt: new Date(),
    })
    .where(eq(activities.id, row.id));
  // keep what upstream said when it changed (content-addressed: no duplicates)
  if (input.raw) {
    const sha = await storeRawPayload(input.raw.bytes, input.raw.kind, { provider, externalId });
    if (sha) await addActivitySource({ activityId: row.id, provider, externalId, kind: input.raw.kind, rawSha256: sha });
  }
  if (merged.applied.length > 0) await invalidateCache("activities_list", "activities_latest");
  return { rowId: row.id, applied: merged.applied };
}
