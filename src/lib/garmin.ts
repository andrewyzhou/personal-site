// garmin connect personal api → neon. a second activity source next to
// intervals.icu: pull-only, read-only, the owner's own key. endpoints, auth
// and paging follow garmin's reference client
// (github.com/garmin/connect-personal-api-python, constants.py, auth.py,
// client.py):
//   - POST /personalapitoken-service/personal-api/personal-api-key/token with
//     `Authorization: ApiKey <key>` returns a jwt bearer token (no refresh
//     token); it is cached in kv until an hour before its `exp`
//   - GET /activitylist-service/activities/search/activities?start&limit&startDate&endDate
//   - GET /activity-service/activity/{id}
//   - GET /download-service/files/activity/{id} → the original as a zip
// imports mirror intervals.ts: the original + the activity json are kept raw
// and linked as sources, rows are deduped by start time against whatever is
// already here, and metadata follows newest edit wins. off when
// GARMIN_PERSONAL_API_KEY is unset. server-only.

import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb, activities, activitySources } from "./db";
import {
  buildActivityValues,
  computePublished,
  dedupeKey,
  findSameActivity,
  insertActivity,
  localDateTime,
  DEFAULT_PRIVACY_TRIM_M,
} from "./activities";
import { parseTrackFile, unwrapTrackFile } from "./fit";
import {
  addActivitySource,
  findActivityIdBySource,
  hasDeviceFile,
  storeOriginal,
  storeRawPayload,
  type StoredOriginal,
} from "./activity-sources";
import { republish } from "./republish";
import { invalidateCache, kvDel, kvGet, kvSet } from "./cache";
import { garminSportType } from "./sport-map";
import { mergeUpstreamMeta, type UpstreamSnapshot, type UpstreamValues } from "./metadata-merge";
import { applyUpstreamMeta, loadMetaRow, type MetaOutcome } from "./upstream-meta";
import { isDryRun, syncEvent, syncFetch, throwIfUnavailable, UpstreamUnavailableError } from "./sync-log";
import { sha256Hex } from "./raw-store";
import { isGarminConfigured } from "./garmin-config";

export { isGarminConfigured };

export const GARMIN_DEFAULT_BASE_URL = "https://personal.connectapi.garmin.com";
export const GARMIN_TOKEN_PATH = "/personalapitoken-service/personal-api/personal-api-key/token";
const PROVIDER = "garmin";
const SOURCE = "garmin"; // the sync-log name
const FETCH_TIMEOUT_MS = 30_000; // the reference client's default
const TOKEN_REFRESH_WINDOW_S = 60 * 60; // the reference client's: renew an hour early
const PAGE_SIZE = 50;
const MAX_PAGES = 5;
const MAX_NEW_PER_RUN = 10;
export const GARMIN_LOOKBACK_DAYS = 7;
export const GARMIN_METADATA_LOOKBACK_DAYS = 14;

// what the search list returns per activity. only activityId, activityName,
// startTimeLocal and startTimeGMT are read by the reference client; the rest
// are garmin connect's usual summary fields, all optional here.
export interface GarminActivity {
  activityId: number | string;
  activityName?: string | null;
  description?: string | null;
  activityType?: { typeKey?: string | null } | string | null;
  startTimeGMT?: string | null; // "2026-10-03 15:02:52" (utc)
  startTimeLocal?: string | null; // "2026-10-03 08:02:52"
  beginTimestamp?: number | null; // epoch ms
  duration?: number | null;
  elapsedDuration?: number | null;
  movingDuration?: number | null;
  distance?: number | null;
  elevationGain?: number | null;
  averageSpeed?: number | null;
  maxSpeed?: number | null;
  averageHR?: number | null;
  maxHR?: number | null;
  avgPower?: number | null;
  averageRunningCadenceInStepsPerMinute?: number | null;
  averageBikingCadenceInRevPerMinute?: number | null;
}

function baseUrl(): string {
  return (process.env.GARMIN_PERSONAL_API_BASE_URL || GARMIN_DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function apiKey(): string {
  const key = process.env.GARMIN_PERSONAL_API_KEY?.trim();
  if (!key) throw new Error("GARMIN_PERSONAL_API_KEY is not set");
  return key;
}

// ---------------------------------------------------------------------------
// token

// the jwt's `exp` (seconds), read without verifying (as the reference client does)
export function jwtExpiration(token: string): number {
  try {
    const payload = token.split(".")[1];
    const json = JSON.parse(Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
    const exp = Number(json.exp);
    if (!Number.isFinite(exp)) throw new Error("no exp");
    return exp;
  } catch {
    throw new Error("garmin token endpoint did not return a jwt with an exp claim");
  }
}

// cached per key + base url, like the reference client's fingerprint, so a
// new key never reuses the old key's token
function tokenCacheKey(): string {
  const fp = createHash("sha256").update(`${baseUrl()}\0${apiKey()}`).digest("hex").slice(0, 16);
  return `garmin_token:${fp}`;
}

interface CachedToken {
  token: string;
  expiresAt: number; // seconds
}

export async function getGarminToken(nowMs = Date.now()): Promise<string> {
  const cacheKey = tokenCacheKey();
  const cached = await kvGet<CachedToken>(cacheKey);
  if (cached?.token && cached.expiresAt - nowMs / 1000 > TOKEN_REFRESH_WINDOW_S) return cached.token;

  const response = await syncFetch(SOURCE, `${baseUrl()}${GARMIN_TOKEN_PATH}`, {
    method: "POST",
    headers: { Accept: "*/*", Authorization: `ApiKey ${apiKey()}` },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  throwIfUnavailable(response, SOURCE);
  if (!response.ok) {
    // 401/403: the key expired or was revoked. the owner makes a new one.
    throw new Error(`garmin token exchange: ${response.status} (is GARMIN_PERSONAL_API_KEY still valid?)`);
  }
  const token = (await response.text()).trim();
  const expiresAt = jwtExpiration(token);
  const ttl = expiresAt - nowMs / 1000 - TOKEN_REFRESH_WINDOW_S;
  if (ttl > 0 && !isDryRun()) await kvSet(cacheKey, { token, expiresAt } satisfies CachedToken, ttl);
  return token;
}

async function garminGet(path: string, accept = "application/json"): Promise<Response> {
  const token = await getGarminToken();
  const response = await syncFetch(SOURCE, `${baseUrl()}${path}`, {
    headers: { Accept: accept, Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  throwIfUnavailable(response, SOURCE);
  if (response.status === 401) {
    // revoked before it expired: drop it, the next run exchanges the key again
    if (!isDryRun()) await kvDel(tokenCacheKey());
    throw new Error("garmin rejected the bearer token (dropped from the cache)");
  }
  return response;
}

// ---------------------------------------------------------------------------
// endpoints

// the search answer is a list, or an object holding one (the reference
// client accepts both)
export function activityRecords(value: unknown): GarminActivity[] {
  const list = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? ((value as { activities?: unknown }).activities ?? (value as { activityList?: unknown }).activityList)
      : null;
  if (!Array.isArray(list)) return [];
  return list.filter(
    (r): r is GarminActivity =>
      !!r && typeof r === "object" && (typeof r.activityId === "number" || typeof r.activityId === "string")
  );
}

export async function searchGarminActivities(opts: {
  start?: number;
  limit?: number;
  startDate?: string;
  endDate?: string;
}): Promise<GarminActivity[]> {
  const params = new URLSearchParams({ start: String(opts.start ?? 0), limit: String(opts.limit ?? 20) });
  if (opts.startDate) params.set("startDate", opts.startDate);
  if (opts.endDate) params.set("endDate", opts.endDate);
  const response = await garminGet(`/activitylist-service/activities/search/activities?${params}`);
  if (!response.ok) throw new Error(`garmin activity search: ${response.status}`);
  const text = await response.text();
  return text ? activityRecords(JSON.parse(text)) : [];
}

// every activity between two calendar dates (inclusive), paged with start/limit
export async function listGarminActivities(startDate: string, endDate: string): Promise<GarminActivity[]> {
  const out: GarminActivity[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const batch = await searchGarminActivities({ start: page * PAGE_SIZE, limit: PAGE_SIZE, startDate, endDate });
    out.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  const seen = new Set<string>();
  return out
    .filter((a) => {
      const id = String(a.activityId);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .sort((a, b) => (garminStart(a)?.getTime() ?? 0) - (garminStart(b)?.getTime() ?? 0));
}

const validId = (id: string) => /^\d{1,20}$/.test(id) && Number(id) > 0;

// the activity's own summary json, kept as the exact bytes received
export async function fetchGarminActivity(id: string): Promise<{ bytes: Uint8Array; data: GarminActivity } | null> {
  if (!validId(id)) throw new Error(`garmin activity id ${id} is not a positive integer`);
  const response = await garminGet(`/activity-service/activity/${id}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`garmin activity ${id}: ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length === 0) return null;
  return { bytes, data: JSON.parse(new TextDecoder().decode(bytes)) as GarminActivity };
}

// the original file as garmin serves it (a zip holding the .fit), or null
// when there is none (manual entries)
export async function downloadGarminOriginal(id: string): Promise<Uint8Array | null> {
  if (!validId(id)) throw new Error(`garmin activity id ${id} is not a positive integer`);
  const response = await garminGet(
    `/download-service/files/activity/${id}`,
    "application/zip, application/x-zip-compressed, application/octet-stream"
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`garmin download ${id}: ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  return bytes.length > 0 ? bytes : null;
}

// ---------------------------------------------------------------------------
// mapping

const garminTime = (s: string) => new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s.replace(" ", "T") : `${s.replace(" ", "T")}Z`);

export function garminStart(a: GarminActivity): Date | null {
  if (typeof a.beginTimestamp === "number" && Number.isFinite(a.beginTimestamp)) return new Date(a.beginTimestamp);
  if (a.startTimeGMT) {
    const d = garminTime(a.startTimeGMT);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

// minutes east of utc, from the local and utc start strings
export function garminOffsetMin(a: GarminActivity): number {
  const start = garminStart(a);
  if (!start || !a.startTimeLocal) return 0;
  const local = new Date(`${a.startTimeLocal.replace(" ", "T").replace(/[zZ]$/, "")}Z`);
  if (Number.isNaN(local.getTime())) return 0;
  return Math.round((local.getTime() - start.getTime()) / 60000);
}

const typeKey = (a: GarminActivity) =>
  typeof a.activityType === "string" ? a.activityType : (a.activityType?.typeKey ?? null);

// what garmin says about the fields newest-edit-wins tracks. a field the
// answer doesn't carry stays undefined ("doesn't say"), so it is never blanked.
export function garminUpstreamValues(a: GarminActivity): UpstreamValues {
  const key = typeKey(a);
  return {
    ...(a.activityName !== undefined ? { name: a.activityName } : {}),
    ...(a.description !== undefined ? { description: a.description } : {}),
    ...(key ? { sportType: garminSportType(key) } : {}),
  };
}

function firstSnapshot(a: GarminActivity, now: Date): UpstreamSnapshot {
  return mergeUpstreamMeta({
    current: { name: "", description: null, sportType: "", hidden: false },
    siteEdits: null,
    previous: null,
    upstream: garminUpstreamValues(a),
    provider: PROVIDER,
    externalId: String(a.activityId),
    changedAt: null,
    now,
  }).snapshot;
}

// parse an original + keep its bytes (the zip as received). the file's own
// sport/sub_sport is the sport type's ground truth.
async function fromOriginal(a: GarminActivity, bytes: Uint8Array) {
  const id = String(a.activityId);
  const filename = `${id}.zip`;
  const parsed = parseTrackFile(bytes, filename);
  const stored = await storeOriginal(bytes, filename, parsed.startDateUtc, {
    provider: PROVIDER,
    externalId: id,
    url: `${baseUrl()}/download-service/files/activity/${id}`,
  });
  const hasGps = parsed.records.some((r) => r.lat !== null);
  const trim = hasGps ? DEFAULT_PRIVACY_TRIM_M : 0;
  const published = computePublished(parsed, trim, trim);
  const key = typeKey(a);
  const values = buildActivityValues(parsed, published, {
    name: a.activityName || parsed.suggestedName,
    description: a.description || null,
    sportType: parsed.fileType === "fit" ? parsed.sportType : garminSportType(key),
    source: PROVIDER,
    externalId: id,
    fitBlobUrl: stored.legacy?.url ?? null,
    fitBlobPathname: stored.legacy?.pathname ?? null,
    fitSha256: stored.legacy?.sha256 ?? null,
    utcOffsetMinFallback: garminOffsetMin(a),
  });
  return { values, stored };
}

// no file: summary stats only
function fromSummary(a: GarminActivity, start: Date) {
  const utcOffsetMin = garminOffsetMin(a);
  const { localDate, localTime } = localDateTime(start, utcOffsetMin);
  const elapsed = Math.round(a.elapsedDuration ?? a.duration ?? a.movingDuration ?? 0);
  const cadence = a.averageRunningCadenceInStepsPerMinute ?? a.averageBikingCadenceInRevPerMinute ?? null;
  return {
    name: a.activityName || "workout",
    sportType: garminSportType(typeKey(a)),
    startDateUtc: start,
    localDate,
    localTime,
    utcOffsetMin,
    distanceM: a.distance ?? 0,
    movingTimeS: Math.round(a.movingDuration ?? a.duration ?? elapsed),
    elapsedTimeS: elapsed,
    elevGainM: a.elevationGain ?? 0,
    avgSpeedMs: a.averageSpeed ?? 0,
    maxSpeedMs: a.maxSpeed ?? 0,
    avgHr: a.averageHR ?? null,
    maxHr: a.maxHR ?? null,
    avgCadence: cadence,
    avgWatts: a.avgPower ?? null,
    kilojoules: null,
    description: a.description || null,
    source: PROVIDER,
    externalId: String(a.activityId),
    fileType: null,
    dedupeKey: dedupeKey(start.getTime() / 1000, elapsed),
  };
}

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
  if (jsonSha) await addActivitySource({ ...base, kind: "garmin-activity", rawSha256: jsonSha });
}

async function storeActivityJson(id: string): Promise<string | null> {
  const fresh = await fetchGarminActivity(id);
  if (!fresh) return null;
  return storeRawPayload(fresh.bytes, "garmin-activity", { provider: PROVIDER, externalId: id });
}

// the row a garmin activity belongs to: its own row, or one it was attached to
export async function findGarminRow(id: string): Promise<number | null> {
  const own = await getDb()
    .select({ id: activities.id })
    .from(activities)
    .where(and(eq(activities.source, PROVIDER), eq(activities.externalId, id)))
    .limit(1);
  return own[0]?.id ?? (await findActivityIdBySource(PROVIDER, id));
}

// the shas of the device files already linked to a row (plus its legacy column)
async function deviceFileShas(activityId: number, legacySha: string | null): Promise<Set<string>> {
  const rows = await getDb()
    .select({ sha: activitySources.rawSha256 })
    .from(activitySources)
    .where(and(eq(activitySources.activityId, activityId), eq(activitySources.kind, "device-file")));
  const out = new Set(rows.map((r) => r.sha).filter((s): s is string => !!s));
  if (legacySha) out.add(legacySha);
  return out;
}

export type GarminImportOutcome = "inserted" | "upgraded" | "linked" | "known" | "skipped";

// import one activity. the same workout already here (intervals, an upload,
// an archive) is never duplicated:
//   - row without a device file: garmin's original is attached, republished;
//   - row with one: garmin's file is compared with it. identical (they should
//     be: both are the watch's fit) → only linked, one copy kept. different →
//     kept raw and linked too (raw is never dropped), but the file already
//     publishing stays (republish: first attached device file wins).
// either way garmin's snapshot becomes the row's metadata baseline, so later
// renames in garmin connect reach it through this source.
export async function importGarminActivity(a: GarminActivity, opts: { now?: Date } = {}): Promise<GarminImportOutcome> {
  const id = String(a.activityId);
  const start = garminStart(a);
  if (!validId(id) || !start) {
    await syncEvent({ source: SOURCE, kind: "skip", externalId: id, detail: { reason: "no usable id or start time" } });
    return "skipped";
  }
  if ((await findGarminRow(id)) !== null) return "known";
  const now = opts.now ?? new Date();
  const db = getDb();
  const dry = isDryRun();

  const same = await findSameActivity(start);
  if (same) {
    const sameHasFile = !!same.fitBlobPathname || (await hasDeviceFile(same.id));
    const merge = {
      matchedBy: "start time",
      start: start.toISOString(),
      rowSource: same.source,
      rowHasFile: sameHasFile,
      rowName: same.name,
      upstreamName: a.activityName ?? null,
    };
    if (dry) {
      await syncEvent({
        source: SOURCE,
        kind: "merge",
        activityId: same.id,
        externalId: id,
        detail: {
          ...merge,
          action: sameHasFile
            ? "download original, compare with the attached file, link (garmin then follows metadata)"
            : "download original, attach, republish",
        },
      });
      return sameHasFile ? "linked" : "upgraded";
    }
    const jsonSha = await storeActivityJson(id);
    const bytes = await downloadGarminOriginal(id);
    await db.update(activities).set({ upstreamMeta: firstSnapshot(a, now), updatedAt: new Date() }).where(eq(activities.id, same.id));

    if (!bytes) {
      await attachSources(same.id, id, null, jsonSha, { summaryMarker: !sameHasFile });
      await syncEvent({ source: SOURCE, kind: "merge", activityId: same.id, externalId: id, detail: { ...merge, action: "linked (no original file upstream)" } });
      return "linked";
    }

    if (sameHasFile) {
      const existing = await deviceFileShas(same.id, same.fitSha256);
      const outerSha = sha256Hex(bytes);
      const innerSha = sha256Hex(unwrapTrackFile(bytes, `${id}.zip`).bytes);
      if (existing.has(outerSha) || existing.has(innerSha)) {
        await attachSources(same.id, id, null, jsonSha, { summaryMarker: false });
        await syncEvent({
          source: SOURCE,
          kind: "merge",
          activityId: same.id,
          externalId: id,
          detail: { ...merge, action: "linked: garmin's fit is identical to the attached file, one copy kept", sha256: innerSha },
        });
        return "linked";
      }
      const stored = await storeOriginal(bytes, `${id}.zip`, start, { provider: PROVIDER, externalId: id });
      await attachSources(same.id, id, stored, jsonSha);
      await syncEvent({
        source: SOURCE,
        kind: "attach",
        activityId: same.id,
        externalId: id,
        detail: {
          ...merge,
          action: "linked: garmin's fit differs from the attached file; kept raw, the attached file keeps publishing",
          garminSha256: innerSha,
          attached: [...existing],
        },
      });
      return "linked";
    }

    const { values, stored } = await fromOriginal(a, bytes);
    if (stored.legacy) {
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
    await attachSources(same.id, id, stored, jsonSha);
    await syncEvent({
      source: SOURCE,
      kind: "attach",
      activityId: same.id,
      externalId: id,
      detail: { ...merge, action: "original attached, republished", rawSha256: stored.rawSha256, bytes: bytes.length },
    });
    await republish(same.id);
    return "upgraded";
  }

  if (dry) {
    await syncEvent({
      source: SOURCE,
      kind: "insert",
      externalId: id,
      detail: { action: "would insert", start: start.toISOString(), name: a.activityName ?? null, typeKey: typeKey(a) },
    });
    return "inserted";
  }
  const jsonSha = await storeActivityJson(id);
  const bytes = await downloadGarminOriginal(id);
  const built = bytes ? await fromOriginal(a, bytes) : null;
  const row = built ? built.values : fromSummary(a, start);
  const outcome = await insertActivity({ ...row, upstreamMeta: firstSnapshot(a, now) });
  if (!outcome.inserted) {
    await syncEvent({ source: SOURCE, kind: "skip", activityId: outcome.id, externalId: id, detail: { reason: "dedupe key already present" } });
    return "skipped";
  }
  await attachSources(outcome.id, id, built?.stored ?? null, jsonSha);
  await syncEvent({
    source: SOURCE,
    kind: "insert",
    activityId: outcome.id,
    externalId: id,
    detail: {
      start: start.toISOString(),
      name: row.name,
      sportType: row.sportType,
      from: built ? "original file" : "summary only",
      ...(built ? { rawSha256: built.stored.rawSha256, bytes: bytes!.length } : {}),
    },
  });
  await republish(outcome.id);
  return "inserted";
}

export async function applyGarminMetadata(id: string, upstream: UpstreamValues, opts: { now?: Date } = {}): Promise<MetaOutcome> {
  const rowId = await findGarminRow(id);
  if (rowId === null) return { rowId: null, applied: [] };
  const row = await loadMetaRow(rowId);
  if (!row) return { rowId: null, applied: [] };
  return applyUpstreamMeta({ row, provider: PROVIDER, source: SOURCE, externalId: id, upstream, now: opts.now });
}

export interface GarminPullResult {
  inserted: number;
  upgraded: number;
  linked: number;
  updated: number;
  skipped: number;
  failures: { id: string; error: string }[];
  more: boolean;
}

// import what's new from the last `days`, re-apply metadata for the last
// `metadataDays`. a 429/5xx ends the pull (UpstreamUnavailableError).
export async function pullGarminActivities({
  days = GARMIN_LOOKBACK_DAYS,
  metadataDays = GARMIN_METADATA_LOOKBACK_DAYS,
  now = new Date(),
}: { days?: number; metadataDays?: number; now?: Date } = {}): Promise<GarminPullResult> {
  const lookback = Math.max(days, metadataDays);
  // garmin's dates are local calendar days: pad a day each side
  const startDate = new Date(now.getTime() - (lookback + 1) * 86400000).toISOString().slice(0, 10);
  const endDate = new Date(now.getTime() + 86400000).toISOString().slice(0, 10);
  const importFrom = now.getTime() - days * 86400000;
  const metaFrom = now.getTime() - metadataDays * 86400000;
  const listed = await listGarminActivities(startDate, endDate);
  const result: GarminPullResult = { inserted: 0, upgraded: 0, linked: 0, updated: 0, skipped: 0, failures: [], more: false };

  let work = 0;
  for (const a of listed) {
    const id = String(a.activityId);
    try {
      const started = garminStart(a)?.getTime() ?? 0;
      if ((await findGarminRow(id)) !== null) {
        if (started < metaFrom) {
          result.skipped++;
          continue;
        }
        const { applied } = await applyGarminMetadata(id, garminUpstreamValues(a), { now });
        if (applied.length > 0) result.updated++;
        else result.skipped++;
        continue;
      }
      if (started < importFrom) {
        result.skipped++;
        continue;
      }
      if (work >= MAX_NEW_PER_RUN) {
        result.more = true;
        continue;
      }
      work++;
      const outcome = await importGarminActivity(a, { now });
      if (outcome === "inserted" || outcome === "upgraded" || outcome === "linked") result[outcome]++;
      else result.skipped++;
    } catch (error) {
      if (error instanceof UpstreamUnavailableError) throw error;
      result.failures.push({ id, error: (error as Error).message });
      await syncEvent({ source: SOURCE, kind: "error", externalId: id, detail: { message: (error as Error).message } });
    }
  }

  if (result.more) {
    await syncEvent({ source: SOURCE, kind: "skip", detail: { reason: `more than ${MAX_NEW_PER_RUN} new: the rest wait for the next run` } });
  }
  if (result.inserted + result.upgraded + result.updated > 0 && !isDryRun()) {
    await invalidateCache("activities_list", "activities_latest");
  }
  return result;
}
