// intervals.icu → neon. garmin pushes every activity to intervals.icu (an
// official garmin partner) within a minute or two of a watch sync, and
// forwards name/description edits; its api serves the original file. this is
// the activity import path:
//   - real time: POST /api/intervals/webhook (ACTIVITY_UPLOADED / _UPDATED…)
//   - safety net: the scheduled pull (new activities from the last week, and
//     metadata updates for the last two weeks)
// the original and the activity json are kept as raw objects, linked as
// sources, and republish() builds the published route/stats. never
// destructive: insert-only rows and sources; metadata follows newest edit wins
// (metadata-merge.ts). server-only.

import { eq } from "drizzle-orm";
import { getDb, activities } from "./db";
import {
  buildActivityValues,
  computePublished,
  dedupeKey,
  findSameActivity,
  insertActivity,
  localDateTime,
  DEFAULT_PRIVACY_TRIM_M,
} from "./activities";
import { parseTrackFile } from "./fit";
import {
  addActivitySource,
  findActivityIdBySource,
  hasDeviceFile,
  storeOriginal,
  storeRawPayload,
  type StoredOriginal,
} from "./activity-sources";
import { republish } from "./republish";
import { invalidateCache } from "./cache";
import { intervalsSportType } from "./sport-map";
import { mergeUpstreamMeta, type UpstreamSnapshot } from "./metadata-merge";
import { applyUpstreamMeta, loadMetaRow, type MetaOutcome } from "./upstream-meta";
import { isDryRun, syncEvent, syncFetch, throwIfUnavailable, UpstreamUnavailableError } from "./sync-log";
import { isGarminConfigured } from "./garmin-config";

const API = "https://intervals.icu/api/v1";
const PROVIDER = "intervals-icu";
const SOURCE = "intervals"; // the sync-log name
const FETCH_TIMEOUT_MS = 15000;
// each new activity is a file download + parse + raw put; keep a run well
// inside the 60s function limit and let the next run continue
const MAX_NEW_PER_RUN = 10;
const DEFAULT_LOOKBACK_DAYS = 7;
// metadata edits made upstream (a rename in garmin connect) are re-checked
// this far back by the scheduled pull, in case a webhook was missed
export const METADATA_LOOKBACK_DAYS = 14;

export interface IntervalsActivity {
  id: string; // "i123456"
  name?: string | null;
  type?: string | null; // a site sport type (sport-types.ts) or "Other"
  trainer?: boolean | null; // indoor: treadmill / trainer
  source?: string | null; // GARMIN_CONNECT, UPLOAD, MANUAL, STRAVA…
  start_date?: string | null; // utc
  start_date_local?: string | null;
  description?: string | null;
  distance?: number | null;
  moving_time?: number | null;
  elapsed_time?: number | null;
  total_elevation_gain?: number | null;
  average_speed?: number | null;
  max_speed?: number | null;
  average_heartrate?: number | null;
  max_heartrate?: number | null;
  average_cadence?: number | null;
  icu_average_watts?: number | null;
  icu_joules?: number | null;
  file_type?: string | null;
}

export function isIntervalsConfigured(): boolean {
  return Boolean(process.env.INTERVALS_ICU_API_KEY);
}

function authHeader(): string {
  const key = process.env.INTERVALS_ICU_API_KEY;
  if (!key) throw new Error("INTERVALS_ICU_API_KEY is not set");
  return `Basic ${Buffer.from(`API_KEY:${key}`).toString("base64")}`;
}

async function intervalsFetch(path: string): Promise<Response> {
  const response = await syncFetch(SOURCE, `${API}${path}`, {
    headers: { Authorization: authHeader() },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  throwIfUnavailable(response, SOURCE);
  if (response.status === 401 || response.status === 403) {
    throw new Error("intervals.icu rejected the api key");
  }
  return response;
}

// the activity's utc offset in minutes, from its utc and local start strings
function offsetMin(a: IntervalsActivity): number {
  if (!a.start_date || !a.start_date_local) return 0;
  const utc = new Date(a.start_date).getTime();
  const local = new Date(`${a.start_date_local.replace(/Z$/, "")}Z`).getTime();
  return Math.round((local - utc) / 60000);
}

// stubs synced in from another service carry no data (that service's api
// terms), and intervals sends no webhooks for them
const isImportable = (a: IntervalsActivity) => a.source !== "STRAVA" && !!a.start_date;

export async function listActivities(oldest: string, newest?: string): Promise<IntervalsActivity[]> {
  const athlete = process.env.INTERVALS_ICU_ATHLETE_ID || "0"; // 0 = the key's own athlete
  const range = `oldest=${oldest}${newest ? `&newest=${newest}` : ""}`;
  const response = await intervalsFetch(`/athlete/${athlete}/activities?${range}`);
  if (!response.ok) {
    throw new Error(`intervals.icu list: ${response.status} ${await response.text()}`);
  }
  const list = (await response.json()) as IntervalsActivity[];
  return list.filter(isImportable).sort((a, b) => a.start_date!.localeCompare(b.start_date!));
}

// one activity, re-read from the api (webhook payloads are never trusted).
// null when it no longer exists.
export async function fetchActivity(id: string): Promise<{ bytes: Uint8Array; data: IntervalsActivity } | null> {
  const response = await intervalsFetch(`/activity/${encodeURIComponent(id)}`);
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`intervals.icu activity ${id}: ${response.status} ${await response.text()}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  return { bytes, data: JSON.parse(new TextDecoder().decode(bytes)) as IntervalsActivity };
}

// original file bytes as served, or null when the activity has none (manual
// entries). always /file (the original upload), never /fit-file (a re-encode).
export async function downloadOriginal(id: string): Promise<Uint8Array | null> {
  const response = await intervalsFetch(`/activity/${encodeURIComponent(id)}/file`);
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`intervals.icu file ${id}: ${response.status} ${await response.text()}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  return bytes.length > 0 ? bytes : null;
}

// the activity json, kept as the exact bytes received; null when not stored
async function storeActivityJson(id: string, bytes?: Uint8Array): Promise<string | null> {
  const body = bytes ?? (await fetchActivity(id))?.bytes;
  if (!body) return null;
  return storeRawPayload(body, "intervals-activity", { provider: PROVIDER, externalId: id });
}

const upstreamValues = (a: IntervalsActivity) => ({
  name: a.name ?? null,
  description: a.description ?? null,
  sportType: a.type ? intervalsSportType(a.type, a.trainer) : null,
});

// the snapshot written with a new row: what intervals said at import
function firstSnapshot(a: IntervalsActivity, now: Date): UpstreamSnapshot {
  return mergeUpstreamMeta({
    current: { name: "", description: null, sportType: "", hidden: false },
    siteEdits: null,
    previous: null,
    upstream: upstreamValues(a),
    provider: PROVIDER,
    externalId: a.id,
    changedAt: null,
    now,
  }).snapshot;
}

// parse an original + keep its bytes. the insert row carries the default trim;
// republish then owns the published columns. the file's own sport/sub_sport
// is the sport type's ground truth.
async function fromOriginal(a: IntervalsActivity, bytes: Uint8Array) {
  const filename = `${a.id}.${a.file_type || "fit"}`;
  const parsed = parseTrackFile(bytes, filename);
  const stored = await storeOriginal(bytes, filename, parsed.startDateUtc, {
    provider: PROVIDER,
    externalId: a.id,
    url: `${API}/activity/${a.id}/file`,
  });
  const hasGps = parsed.records.some((r) => r.lat !== null);
  const trim = hasGps ? DEFAULT_PRIVACY_TRIM_M : 0;
  const published = computePublished(parsed, trim, trim);
  const sportType = parsed.fileType === "fit" ? parsed.sportType : intervalsSportType(a.type, a.trainer);
  const values = buildActivityValues(parsed, published, {
    name: a.name || parsed.suggestedName,
    description: a.description || null,
    sportType,
    source: PROVIDER,
    externalId: a.id,
    // legacy public copy, only before the private store exists
    fitBlobUrl: stored.legacy?.url ?? null,
    fitBlobPathname: stored.legacy?.pathname ?? null,
    fitSha256: stored.legacy?.sha256 ?? null,
    utcOffsetMinFallback: offsetMin(a),
  });
  return { values, stored };
}

// no file: summary stats only
function fromSummary(a: IntervalsActivity) {
  const startDateUtc = new Date(a.start_date!);
  const utcOffsetMin = offsetMin(a);
  const { localDate, localTime } = localDateTime(startDateUtc, utcOffsetMin);
  const elapsed = Math.round(a.elapsed_time ?? a.moving_time ?? 0);
  return {
    name: a.name || "workout",
    sportType: intervalsSportType(a.type, a.trainer),
    startDateUtc,
    localDate,
    localTime,
    utcOffsetMin,
    distanceM: a.distance ?? 0,
    movingTimeS: Math.round(a.moving_time ?? elapsed),
    elapsedTimeS: elapsed,
    elevGainM: a.total_elevation_gain ?? 0,
    avgSpeedMs: a.average_speed ?? 0,
    maxSpeedMs: a.max_speed ?? 0,
    avgHr: a.average_heartrate ?? null,
    maxHr: a.max_heartrate ?? null,
    avgCadence: a.average_cadence ?? null,
    avgWatts: a.icu_average_watts ?? null,
    kilojoules: a.icu_joules ? a.icu_joules / 1000 : null,
    description: a.description || null,
    source: PROVIDER,
    externalId: a.id,
    fileType: null,
    dedupeKey: dedupeKey(startDateUtc.getTime() / 1000, elapsed),
  };
}

// link what we kept to the row: the original (or a summary marker) + the json
async function attachSources(
  activityId: number,
  externalId: string,
  stored: StoredOriginal | null,
  jsonSha: string | null,
  { summaryMarker = true } = {}
): Promise<void> {
  const base = { activityId, provider: PROVIDER, externalId } as const;
  if (stored) await addActivitySource({ ...base, kind: "device-file", rawSha256: stored.rawSha256 });
  else if (summaryMarker) await addActivitySource({ ...base, kind: "summary" });
  if (jsonSha) await addActivitySource({ ...base, kind: "intervals-activity", rawSha256: jsonSha });
}

// the row an intervals activity belongs to: its own row, or the row it was
// attached to as a source
export async function findLinkedRow(id: string): Promise<number | null> {
  const own = await getDb().select({ id: activities.id }).from(activities).where(eq(activities.externalId, id)).limit(1);
  return own[0]?.id ?? (await findActivityIdBySource(PROVIDER, id));
}

export type ImportOutcome = "inserted" | "upgraded" | "linked" | "known" | "skipped";

// a row whose metadata the garmin personal api follows (garmin wrote the last
// snapshot): intervals only mirrors garmin connect, so it leaves those alone
const garminOwns = (snapshot: UpstreamSnapshot | null | undefined) =>
  snapshot?.provider === "garmin" && isGarminConfigured();

// import one activity the way the pull does. a workout already on the site
// from another source is never duplicated: without a device file it gets the
// original attached (route + stats rebuilt, its name and type kept); with one
// it is only linked, so later garmin renames reach it. a dry run decides and
// logs the same way but writes nothing (and downloads nothing).
export async function importIntervalsActivity(
  a: IntervalsActivity,
  opts: { json?: Uint8Array; now?: Date } = {}
): Promise<ImportOutcome> {
  if (!isImportable(a)) {
    await syncEvent({ source: SOURCE, kind: "skip", externalId: a.id, detail: { reason: "not importable", upstreamSource: a.source ?? null } });
    return "skipped";
  }
  if ((await findLinkedRow(a.id)) !== null) return "known";
  const now = opts.now ?? new Date();
  const db = getDb();
  const dry = isDryRun();

  const same = await findSameActivity(new Date(a.start_date!));
  if (same) {
    const sameHasFile = !!same.fitBlobPathname || (await hasDeviceFile(same.id));
    const merge = {
      matchedBy: "start time",
      start: a.start_date,
      rowSource: same.source,
      rowHasFile: sameHasFile,
      rowName: same.name,
      upstreamName: a.name ?? null,
    };
    if (dry) {
      await syncEvent({
        source: SOURCE,
        kind: "merge",
        activityId: same.id,
        externalId: a.id,
        detail: { ...merge, action: sameHasFile ? "link (row already has a device file)" : "download original, attach, republish" },
      });
      return sameHasFile ? "linked" : "upgraded";
    }
    const bytes = sameHasFile ? null : await downloadOriginal(a.id);
    const jsonSha = await storeActivityJson(a.id, opts.json);
    // the first sighting: later upstream edits are measured against this.
    // a row garmin already follows keeps garmin's snapshot.
    if (!garminOwns(same.upstreamMeta)) {
      await db
        .update(activities)
        .set({ upstreamMeta: firstSnapshot(a, now), updatedAt: new Date() })
        .where(eq(activities.id, same.id));
    }
    if (!bytes) {
      await attachSources(same.id, a.id, null, jsonSha, { summaryMarker: !sameHasFile });
      await syncEvent({
        source: SOURCE,
        kind: "merge",
        activityId: same.id,
        externalId: a.id,
        detail: { ...merge, action: sameHasFile ? "linked (row already has a device file)" : "linked (no original file upstream)" },
      });
      return "linked";
    }
    const { values, stored } = await fromOriginal(a, bytes);
    if (stored.legacy) {
      // pre-cutover: republish finds the original through these columns
      await db
        .update(activities)
        .set({
          fitBlobUrl: stored.legacy.url,
          fitBlobPathname: stored.legacy.pathname,
          fitSha256: stored.legacy.sha256,
          fileType: values.fileType,
          updatedAt: new Date(),
        })
        .where(eq(activities.id, same.id));
    }
    await attachSources(same.id, a.id, stored, jsonSha);
    await syncEvent({
      source: SOURCE,
      kind: "attach",
      activityId: same.id,
      externalId: a.id,
      detail: { ...merge, action: "original attached, republished", rawSha256: stored.rawSha256, bytes: bytes.length },
    });
    await republish(same.id);
    return "upgraded";
  }

  if (dry) {
    await syncEvent({
      source: SOURCE,
      kind: "insert",
      externalId: a.id,
      detail: { action: "would insert", start: a.start_date, name: a.name ?? null, type: a.type ?? null, file: a.file_type ?? null },
    });
    return "inserted";
  }
  const jsonSha = await storeActivityJson(a.id, opts.json);
  const bytes = await downloadOriginal(a.id);
  const built = bytes ? await fromOriginal(a, bytes) : null;
  const row = built ? built.values : fromSummary(a);
  const outcome = await insertActivity({ ...row, upstreamMeta: firstSnapshot(a, now) });
  if (!outcome.inserted) {
    await syncEvent({
      source: SOURCE,
      kind: "skip",
      activityId: outcome.id,
      externalId: a.id,
      detail: { reason: "dedupe key already present", start: a.start_date },
    });
    return "skipped";
  }
  await attachSources(outcome.id, a.id, built?.stored ?? null, jsonSha);
  await syncEvent({
    source: SOURCE,
    kind: "insert",
    activityId: outcome.id,
    externalId: a.id,
    detail: {
      start: a.start_date,
      name: row.name,
      sportType: row.sportType,
      from: built ? "original file" : "summary only",
      ...(built ? { rawSha256: built.stored.rawSha256, bytes: bytes!.length } : {}),
    },
  });
  // summary rows too: republish writes their published (coarsened) start
  await republish(outcome.id);
  return "inserted";
}

export type { MetaOutcome };

// apply upstream metadata (name, description, type; hidden on delete) to the
// linked row, newest edit wins (upstream-meta.ts)
export async function applyIntervalsMetadata(
  id: string,
  upstream: { name?: string | null; description?: string | null; sportType?: string | null; hidden?: boolean },
  opts: { changedAt?: Date | null; now?: Date; json?: Uint8Array } = {}
): Promise<MetaOutcome> {
  const rowId = await findLinkedRow(id);
  if (rowId === null) return { rowId: null, applied: [] };
  const row = await loadMetaRow(rowId);
  if (!row) return { rowId: null, applied: [] };
  if (garminOwns(row.upstreamMeta)) {
    // logged only when the two disagree on what garmin connect says
    const g = row.upstreamMeta!;
    const differs =
      (upstream.name !== undefined && (upstream.name?.trim() || null) !== g.name) ||
      (upstream.description !== undefined && (upstream.description?.trim() || null) !== g.description);
    if (differs) {
      await syncEvent({
        source: SOURCE,
        kind: "skip",
        activityId: rowId,
        externalId: id,
        detail: {
          reason: "garmin follows this row",
          intervals: { name: upstream.name ?? null, description: upstream.description ?? null },
          garmin: { name: g.name, description: g.description },
        },
      });
    }
    return { rowId, applied: [] };
  }
  return applyUpstreamMeta({
    row,
    provider: PROVIDER,
    source: SOURCE,
    externalId: id,
    upstream,
    changedAt: opts.changedAt,
    now: opts.now,
    raw: opts.json ? { bytes: opts.json, kind: "intervals-activity" } : undefined,
  });
}

export interface PullResult {
  inserted: number;
  upgraded: number; // a row without a file given the original's route + stats
  linked: number; // a row that already had a file, now tracking intervals edits
  updated: number; // rows whose metadata changed upstream
  skipped: number;
  failures: { id: string; error: string }[];
  more: boolean;
}

// the safety net behind the webhook: import what's new from the last `days`,
// and re-apply metadata for the last `metadataDays`. a 429/5xx from intervals
// ends the pull (UpstreamUnavailableError): the next run picks up from there.
export async function pullIntervalsActivities({
  days = DEFAULT_LOOKBACK_DAYS,
  metadataDays = METADATA_LOOKBACK_DAYS,
}: { days?: number; metadataDays?: number } = {}): Promise<PullResult> {
  const now = Date.now();
  const lookback = Math.max(days, metadataDays);
  const oldest = new Date(now - lookback * 86400000).toISOString().slice(0, 10);
  const importFrom = new Date(now - days * 86400000).toISOString();
  const listed = await listActivities(oldest);
  const result: PullResult = { inserted: 0, upgraded: 0, linked: 0, updated: 0, skipped: 0, failures: [], more: false };

  let work = 0;
  for (const a of listed) {
    try {
      if ((await findLinkedRow(a.id)) !== null) {
        const { applied } = await applyIntervalsMetadata(a.id, upstreamValues(a));
        if (applied.length > 0) result.updated++;
        else result.skipped++;
        continue;
      }
      if (a.start_date! < importFrom) {
        result.skipped++;
        continue;
      }
      if (work >= MAX_NEW_PER_RUN) {
        result.more = true;
        continue;
      }
      work++;
      const outcome = await importIntervalsActivity(a);
      if (outcome === "inserted" || outcome === "upgraded" || outcome === "linked") result[outcome]++;
      else result.skipped++;
    } catch (error) {
      if (error instanceof UpstreamUnavailableError) throw error;
      result.failures.push({ id: a.id, error: (error as Error).message });
      await syncEvent({ source: SOURCE, kind: "error", externalId: a.id, detail: { message: (error as Error).message } });
    }
  }

  if (result.more) {
    await syncEvent({ source: SOURCE, kind: "skip", detail: { reason: `more than ${MAX_NEW_PER_RUN} new: the rest wait for the next run` } });
  }
  if (result.inserted + result.upgraded > 0 && !isDryRun()) {
    await invalidateCache("activities_list", "activities_latest");
  }
  return result;
}

// ---------------------------------------------------------------------------
// webhook events (POST /api/intervals/webhook). ids are the only thing taken
// from a payload; everything else is re-read from the api.

export interface WebhookEvent {
  type: string;
  activityId: string;
  timestamp: Date | null;
}

export interface WebhookOutcome {
  id: string;
  type: string;
  result: ImportOutcome | "updated" | "unchanged" | "hidden" | "gone" | "ignored";
}

const UPDATE_EVENTS = new Set(["ACTIVITY_UPDATED", "ACTIVITY_ANALYZED", "ACTIVITY_ACHIEVEMENTS"]);

export async function handleWebhookEvent(e: WebhookEvent): Promise<WebhookOutcome> {
  const out = (result: WebhookOutcome["result"]): WebhookOutcome => ({ id: e.activityId, type: e.type, result });

  if (e.type === "ACTIVITY_DELETED") {
    // confirm with the api: an unauthenticated payload can't delete anything.
    // a delete only ever hides (history is soft-removed).
    if ((await fetchActivity(e.activityId)) !== null) return out("ignored");
    const { applied } = await applyIntervalsMetadata(e.activityId, { hidden: true }, { changedAt: e.timestamp });
    return out(applied.includes("hidden") ? "hidden" : "unchanged");
  }

  if (e.type !== "ACTIVITY_UPLOADED" && !UPDATE_EVENTS.has(e.type)) return out("ignored");

  const fresh = await fetchActivity(e.activityId);
  if (!fresh) return out("gone");
  const a = fresh.data;
  if (!isImportable(a)) return out("ignored");

  // an update for something not here yet (a missed upload) imports it
  if ((await findLinkedRow(a.id)) === null) {
    const outcome = await importIntervalsActivity(a, { json: fresh.bytes });
    if (outcome === "inserted" || outcome === "upgraded") await invalidateCache("activities_list", "activities_latest");
    return out(outcome);
  }
  const { applied } = await applyIntervalsMetadata(a.id, upstreamValues(a), {
    changedAt: e.timestamp,
    json: fresh.bytes,
  });
  return out(applied.length > 0 ? "updated" : "unchanged");
}

// payload → events. accepts intervals' { secret, events: [{ athlete_id, type,
// timestamp, activity: { id } }] } shape; anything malformed is dropped.
export function parseWebhookEvents(body: unknown, athleteId?: string | null): WebhookEvent[] {
  if (!body || typeof body !== "object") return [];
  const events = (body as { events?: unknown }).events;
  if (!Array.isArray(events)) return [];
  const out: WebhookEvent[] = [];
  const seen = new Set<string>();
  for (const raw of events.slice(0, 100)) {
    if (!raw || typeof raw !== "object") continue;
    const ev = raw as { type?: unknown; athlete_id?: unknown; timestamp?: unknown; activity?: { id?: unknown } | null };
    if (typeof ev.type !== "string") continue;
    // another athlete's event (an app with more than one user) is not ours
    if (athleteId && athleteId !== "0" && ev.athlete_id !== undefined && String(ev.athlete_id) !== athleteId) continue;
    const id = ev.activity && typeof ev.activity === "object" ? ev.activity.id : undefined;
    const activityId = typeof id === "string" || typeof id === "number" ? String(id) : null;
    if (!activityId || !/^[A-Za-z0-9_-]{1,40}$/.test(activityId)) continue;
    const key = `${ev.type}:${activityId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const ts = typeof ev.timestamp === "string" ? new Date(ev.timestamp) : null;
    out.push({ type: ev.type, activityId, timestamp: ts && !Number.isNaN(ts.getTime()) ? ts : null });
  }
  return out;
}
