// server-only io for the cleaning admin api: the untouched canonical track
// (built exactly like republish builds it), the publish context a preview
// needs, and the small insert/stamp-only writes the routes make. nothing here
// deletes a row or touches raw data.

import { and, asc, eq, gte, inArray, isNull, lte, ne } from "drizzle-orm";
import {
  getDb,
  activities,
  activityEdits,
  activitySources,
  activitySuggestions,
  type ActivityRow,
  type ActivityEditRow,
  type ActivitySuggestionRow,
} from "../db";
import {
  boundsOfTracks,
  buildTrack,
  defaultDeps,
  trackCandidates,
  type PublishContext,
  type RepublishDeps,
  type TrackRef,
} from "../republish";
import type { CanonicalTrack } from "../canonical-track";
import { relevantZones } from "../privacy/fog";
import { DEFAULT_PRIVACY_SETTINGS } from "../privacy/settings";
import { staleMark } from "../privacy/stale";
import { DEFAULT_ACTIVITY_SETTINGS } from "./settings";
import { DETECTOR_VERSION } from "./types";
import { mergeTargets, type EditLike } from "./edits";
import { MERGE_WINDOW_MS } from "./plan";

// ---------------------------------------------------------------------------
// tracks

export type CanonicalLoad =
  | { status: "not-found" }
  | { status: "no-track"; row: ActivityRow }
  | { status: "unavailable"; row: ActivityRow; ref: TrackRef }
  | { status: "ok"; row: ActivityRow; track: CanonicalTrack; ref: TrackRef };

// best source first, skipping sources that hold no track; stops at a source
// whose bytes can't be read (never silently falls back past it)
export async function loadTrackForRow(row: ActivityRow, deps: RepublishDeps): Promise<CanonicalLoad> {
  for (const ref of trackCandidates(await deps.loadSources(row.id))) {
    const track = await buildTrack(ref, row, deps);
    if (track === "unavailable") return { status: "unavailable", row, ref };
    if (track) return { status: "ok", row, track, ref };
  }
  return { status: "no-track", row };
}

export async function loadCanonicalTrack(activityId: number, deps: RepublishDeps = defaultDeps()): Promise<CanonicalLoad> {
  const row = await deps.loadActivity(activityId);
  if (!row) return { status: "not-found" };
  return loadTrackForRow(row, deps);
}

// everything publishTrack gets in republish besides the track and edits:
// relevant zones, both settings, the merged activities' tracks, the sport
export async function loadPublishContext(
  row: ActivityRow,
  track: CanonicalTrack,
  edits: EditLike[],
  deps: RepublishDeps = defaultDeps()
): Promise<PublishContext | "unavailable"> {
  const [allZones, settings, activity] = await Promise.all([
    deps.loadZones(),
    deps.loadSettings ? deps.loadSettings() : Promise.resolve(DEFAULT_PRIVACY_SETTINGS),
    deps.loadActivitySettings ? deps.loadActivitySettings() : Promise.resolve(DEFAULT_ACTIVITY_SETTINGS),
  ]);
  const merged: CanonicalTrack[] = [];
  for (const otherId of mergeTargets(edits)) {
    if (otherId === row.id) continue;
    const other = await deps.loadActivity(otherId);
    if (!other) continue;
    const ref = trackCandidates(await deps.loadSources(otherId))[0];
    if (!ref) continue;
    const t = await buildTrack(ref, other, deps);
    if (t === "unavailable") return "unavailable";
    if (t) merged.push(t);
  }
  const zones = relevantZones(allZones, boundsOfTracks([track, ...merged]));
  return { zones, settings, activity, merged, sportType: row.sportType };
}

// ---------------------------------------------------------------------------
// reads

export async function getActivity(id: number): Promise<ActivityRow | null> {
  const rows = await getDb().select().from(activities).where(eq(activities.id, id)).limit(1);
  return rows[0] ?? null;
}

// every edit, reverted ones included, oldest first
export async function listEdits(activityId: number): Promise<ActivityEditRow[]> {
  return getDb().select().from(activityEdits).where(eq(activityEdits.activityId, activityId)).orderBy(asc(activityEdits.id));
}

export async function getEdit(editId: number): Promise<ActivityEditRow | null> {
  const rows = await getDb().select().from(activityEdits).where(eq(activityEdits.id, editId)).limit(1);
  return rows[0] ?? null;
}

// current detector version only, decided ones included
export async function listSuggestions(activityId: number): Promise<ActivitySuggestionRow[]> {
  return getDb()
    .select()
    .from(activitySuggestions)
    .where(and(eq(activitySuggestions.activityId, activityId), eq(activitySuggestions.detectorVersion, DETECTOR_VERSION)))
    .orderBy(asc(activitySuggestions.id));
}

export async function getSuggestion(id: number): Promise<ActivitySuggestionRow | null> {
  const rows = await getDb().select().from(activitySuggestions).where(eq(activitySuggestions.id, id)).limit(1);
  return rows[0] ?? null;
}

export interface MergeCandidate {
  id: number;
  name: string;
  startDateUtc: Date;
  distanceM: number;
  sportType: string;
}

export async function listMergeCandidates(row: Pick<ActivityRow, "id" | "startDateUtc">): Promise<MergeCandidate[]> {
  const t = row.startDateUtc.getTime();
  return getDb()
    .select({ id: activities.id, name: activities.name, startDateUtc: activities.startDateUtc, distanceM: activities.distanceM, sportType: activities.sportType })
    .from(activities)
    .where(and(
      ne(activities.id, row.id),
      eq(activities.hidden, false),
      gte(activities.startDateUtc, new Date(t - MERGE_WINDOW_MS)),
      lte(activities.startDateUtc, new Date(t + MERGE_WINDOW_MS)),
    ))
    .orderBy(asc(activities.startDateUtc))
    .limit(50);
}

export async function listChildren(activityId: number): Promise<{ id: number; name: string; startDateUtc: Date; hidden: boolean }[]> {
  return getDb()
    .select({ id: activities.id, name: activities.name, startDateUtc: activities.startDateUtc, hidden: activities.hidden })
    .from(activities)
    .where(eq(activities.splitFromId, activityId))
    .orderBy(asc(activities.id));
}

export async function findActivityIdByDedupeKey(key: string): Promise<number | null> {
  const rows = await getDb().select({ id: activities.id }).from(activities).where(eq(activities.dedupeKey, key)).limit(1);
  return rows[0]?.id ?? null;
}

// ---------------------------------------------------------------------------
// writes (insert or stamp only)

export async function insertEdit(activityId: number, kind: string, params: Record<string, unknown>, note: string | null): Promise<number> {
  const rows = await getDb()
    .insert(activityEdits)
    .values({ activityId, kind, params, note })
    .returning({ id: activityEdits.id });
  return rows[0].id;
}

// stamps reverted_at once; false when it was already reverted
export async function revertEditOnce(editId: number): Promise<boolean> {
  const rows = await getDb()
    .update(activityEdits)
    .set({ revertedAt: new Date() })
    .where(and(eq(activityEdits.id, editId), isNull(activityEdits.revertedAt)))
    .returning({ id: activityEdits.id });
  return rows.length > 0;
}

// open → decided, only from open (so a racing decision never flips back)
export async function decideSuggestion(id: number, status: "accepted" | "dismissed", editId: number | null): Promise<boolean> {
  const rows = await getDb()
    .update(activitySuggestions)
    .set({ status, editId, decidedAt: new Date() })
    .where(and(eq(activitySuggestions.id, id), eq(activitySuggestions.status, "open")))
    .returning({ id: activitySuggestions.id });
  return rows.length > 0;
}

export async function setHidden(activityId: number, hidden: boolean): Promise<void> {
  await getDb().update(activities).set({ hidden, updatedAt: new Date() }).where(eq(activities.id, activityId));
}

// same raw objects for the split half (identity unique, so retries are no-ops)
export async function copySources(fromId: number, toId: number): Promise<number> {
  const db = getDb();
  const rows = await db
    .select({ provider: activitySources.provider, externalId: activitySources.externalId, kind: activitySources.kind, rawSha256: activitySources.rawSha256 })
    .from(activitySources)
    .where(eq(activitySources.activityId, fromId))
    .orderBy(asc(activitySources.id));
  if (!rows.length) return 0;
  await db.insert(activitySources).values(rows.map((r) => ({ ...r, activityId: toId }))).onConflictDoNothing();
  return rows.length;
}

// flagged before republishing, so a failure midway leaves the rebuild job a
// row to pick up (republish clears the flag)
export async function markStale(ids: number[]): Promise<void> {
  if (!ids.length) return;
  await getDb().update(activities).set(staleMark()).where(inArray(activities.id, ids));
}
