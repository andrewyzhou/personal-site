// helpers shared by every ingest path (upload, intervals.icu,
// scripts): store raw inputs, link them to activities as sources, record edits.
// all writes are insert-only and idempotent. server-only.

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb, activitySources, activityEdits } from "./db";
import { fitBlobPathname } from "./activities";
import { unwrapTrackFile, type TrackFileType } from "./fit";
import { getRawStore, isRawStoreConfigured, sha256Hex, type RawKind } from "./raw-store";
import { r2Head, r2Put, r2PublicUrl } from "./r2";

// stored provider/kind names. "strava" and the "strava-*" kinds are what the
// archive imports and the retired api sync wrote; rows keep them and republish
// still reads them.
export type SourceProvider = "strava" | "intervals-icu" | "upload" | "manual";
export type SourceKind =
  | "device-file"
  | "strava-streams"
  | "strava-detail"
  | "strava-laps"
  | "strava-photos"
  | "intervals-activity"
  | "summary";

export async function addActivitySource(source: {
  activityId: number;
  provider: SourceProvider;
  externalId?: string | null;
  kind: SourceKind;
  rawSha256?: string | null;
}): Promise<void> {
  await getDb()
    .insert(activitySources)
    .values({
      activityId: source.activityId,
      provider: source.provider,
      externalId: source.externalId ?? null,
      kind: source.kind,
      rawSha256: source.rawSha256 ?? null,
    })
    .onConflictDoNothing();
}

// the activity a provider identity is attached to (any kind), newest link first
export async function findActivityIdBySource(provider: SourceProvider, externalId: string): Promise<number | null> {
  const rows = await getDb()
    .select({ activityId: activitySources.activityId })
    .from(activitySources)
    // split halves carry copies of the parent's source rows: the identity belongs to the parent
    .where(and(eq(activitySources.provider, provider), eq(activitySources.externalId, externalId), sql`${activitySources.activityId} not in (select id from activities where split_from_id is not null)`))
    .orderBy(desc(activitySources.id))
    .limit(1);
  return rows[0]?.activityId ?? null;
}

// which of these provider ids are already attached to some activity
export async function knownExternalIds(provider: SourceProvider, externalIds: string[]): Promise<Set<string>> {
  if (externalIds.length === 0) return new Set();
  const rows = await getDb()
    .selectDistinct({ externalId: activitySources.externalId })
    .from(activitySources)
    .where(and(eq(activitySources.provider, provider), inArray(activitySources.externalId, externalIds)));
  return new Set(rows.map((r) => r.externalId).filter((x): x is string => x !== null));
}

// whether a device file (fit/gpx/tcx original) is linked to the activity
export async function hasDeviceFile(activityId: number): Promise<boolean> {
  const rows = await getDb()
    .select({ id: activitySources.id })
    .from(activitySources)
    .where(and(eq(activitySources.activityId, activityId), eq(activitySources.kind, "device-file")))
    .limit(1);
  return rows.length > 0;
}

export async function addActivityEdit(
  activityId: number,
  kind: "trim" | "override",
  params: Record<string, unknown>,
  note?: string
): Promise<number> {
  const rows = await getDb()
    .insert(activityEdits)
    .values({ activityId, kind, params, note: note ?? null })
    .returning({ id: activityEdits.id });
  return rows[0].id;
}

export async function revertActivityEdit(editId: number): Promise<void> {
  await getDb().update(activityEdits).set({ revertedAt: new Date() }).where(eq(activityEdits.id, editId));
}

// raw json/text payload (api responses): stored as the exact bytes received
export async function storeRawPayload(
  bytes: Uint8Array,
  kind: RawKind,
  metadata: Record<string, unknown>,
  contentType = "application/json"
): Promise<string | null> {
  if (!isRawStoreConfigured()) return null;
  const put = await getRawStore().put(bytes, { kind, contentType, metadata });
  return put.sha256;
}

export interface StoredOriginal {
  rawSha256: string; // what the device-file source row points at
  // legacy public-bucket copy, only when the private raw store isn't configured
  legacy: { pathname: string; url: string; sha256: string } | null;
}

const LEGACY_CONTENT_TYPES: Record<TrackFileType, string> = {
  fit: "application/octet-stream",
  gpx: "application/gpx+xml",
  tcx: "application/xml",
};

// keep a device file. with the raw store: the exact bytes as received
// (containers included), private, write-once. without it (pre-cutover): the
// legacy content-addressed public path of the unwrapped track, as before.
export async function storeOriginal(
  bytes: Uint8Array,
  filename: string,
  startDateUtc: Date,
  metadata: Record<string, unknown> = {}
): Promise<StoredOriginal> {
  if (isRawStoreConfigured()) {
    const put = await getRawStore().put(bytes, {
      kind: "device-file",
      contentType: "application/octet-stream",
      filename,
      metadata,
    });
    return { rawSha256: put.sha256, legacy: null };
  }
  const inner = unwrapTrackFile(bytes, filename);
  const sha = sha256Hex(inner.bytes);
  const pathname = fitBlobPathname(sha, inner.fileType, startDateUtc);
  if (!(await r2Head(pathname))) {
    await r2Put(pathname, inner.bytes, LEGACY_CONTENT_TYPES[inner.fileType]);
  }
  return { rawSha256: sha, legacy: { pathname, url: r2PublicUrl(pathname), sha256: sha } };
}
