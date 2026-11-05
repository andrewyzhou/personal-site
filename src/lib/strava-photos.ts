// photos added to a strava activity, imported onto the site's activity.
// the listing and every photo's bytes are kept raw (private bucket); the public
// copy is metadata-stripped; gps and time stay private columns and the public
// pin is written by republish (null inside fog zones). idempotent per photo:
// a photo whose original is already on the activity is skipped.

import { and, eq, max } from "drizzle-orm";
import { getDb, activityPhotos } from "./db";
import { getRawStore, isRawStoreConfigured, sha256Hex } from "./raw-store";
import { storeRawPayload } from "./activity-sources";
import { r2Put } from "./r2";
import { stripImageMetadata, sniffImageFormat, FORMAT_CONTENT_TYPES } from "./image-strip";
import { republish } from "./republish";
import { invalidateCache } from "./cache";
import { log } from "./log";

const API = "https://www.strava.com/api/v3";
const FETCH_TIMEOUT_MS = 20_000;

export interface StravaPhoto {
  unique_id?: string;
  caption?: string | null;
  created_at?: string | null;
  urls?: Record<string, string> | null;
  sizes?: Record<string, [number, number]> | null;
  location?: [number, number] | null;
}

export interface PlannedPhoto {
  uniqueId: string | null;
  url: string;
  width: number | null;
  height: number | null;
  caption: string | null;
  takenAt: Date | null;
  gps: { lat: number; lng: number } | null;
}

// pure: the largest url per photo plus its private metadata
export function planStravaPhotos(list: StravaPhoto[]): PlannedPhoto[] {
  const out: PlannedPhoto[] = [];
  for (const p of list) {
    const urls = p.urls ?? {};
    const size = Object.keys(urls).map(Number).filter(Number.isFinite).sort((a, b) => b - a)[0];
    if (size === undefined) continue;
    const url = urls[String(size)];
    if (typeof url !== "string" || !/^https:\/\//.test(url)) continue;
    const dims = p.sizes?.[String(size)];
    const loc = p.location;
    const taken = p.created_at ? new Date(p.created_at) : null;
    out.push({
      uniqueId: p.unique_id ?? null,
      url,
      width: dims?.[0] ?? null,
      height: dims?.[1] ?? null,
      caption: p.caption?.trim() ? p.caption.trim() : null,
      takenAt: taken && !Number.isNaN(taken.getTime()) ? taken : null,
      gps:
        Array.isArray(loc) && loc.length === 2 && Number.isFinite(loc[0]) && Number.isFinite(loc[1]) && !(loc[0] === 0 && loc[1] === 0)
          ? { lat: loc[0], lng: loc[1] }
          : null,
    });
  }
  return out;
}

export interface PhotoImportResult {
  listed: number;
  added: number;
  skipped: number;
}

export async function importStravaPhotos(activityId: number, stravaId: number, token: string): Promise<PhotoImportResult> {
  const result: PhotoImportResult = { listed: 0, added: 0, skipped: 0 };
  // originals must be kept privately; without the raw store, don't publish anything
  if (!isRawStoreConfigured()) return result;

  const res = await fetch(`${API}/activities/${stravaId}/photos?size=5000&photo_sources=true`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`strava photos ${stravaId}: ${res.status}`);
  const listBytes = new Uint8Array(await res.arrayBuffer());
  const list = JSON.parse(new TextDecoder().decode(listBytes)) as StravaPhoto[];
  const planned = planStravaPhotos(Array.isArray(list) ? list : []);
  result.listed = planned.length;
  if (planned.length === 0) return result;
  await storeRawPayload(listBytes, "strava-photos", { provider: "strava", stravaId, activityId });

  const db = getDb();
  const existing = new Set(
    (await db.select({ sha: activityPhotos.originalSha256 }).from(activityPhotos).where(eq(activityPhotos.activityId, activityId)))
      .map((r) => r.sha)
      .filter((s): s is string => !!s)
  );
  let position = ((await db.select({ m: max(activityPhotos.position) }).from(activityPhotos).where(eq(activityPhotos.activityId, activityId)))[0]?.m ?? -1) + 1;

  for (const p of planned) {
    const img = await fetch(p.url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!img.ok) {
      log.warn("strava:photos", `download failed ${img.status} for ${stravaId}`);
      result.skipped++;
      continue;
    }
    const original = new Uint8Array(await img.arrayBuffer());
    const sha = sha256Hex(original);
    if (existing.has(sha)) {
      result.skipped++;
      continue;
    }
    const format = sniffImageFormat(original);
    if (!format || format === "heic") {
      log.warn("strava:photos", `unsupported image format for ${stravaId}`);
      result.skipped++;
      continue;
    }
    const contentType = FORMAT_CONTENT_TYPES[format];
    await getRawStore().put(original, {
      kind: "photo-original",
      contentType,
      metadata: { provider: "strava", stravaId, uniqueId: p.uniqueId, activityId },
      expectedSha256: sha,
    });
    const publicBytes = stripImageMetadata(original);
    const ext = format === "jpeg" ? "jpg" : format;
    const pathname = `activities/photos/strava/${sha}.${ext}`;
    const { url } = await r2Put(pathname, publicBytes, contentType);
    // a concurrent run may have inserted the same original meanwhile
    const dup = await db
      .select({ id: activityPhotos.id })
      .from(activityPhotos)
      .where(and(eq(activityPhotos.activityId, activityId), eq(activityPhotos.originalSha256, sha)))
      .limit(1);
    if (dup.length) {
      result.skipped++;
      continue;
    }
    await db.insert(activityPhotos).values({
      activityId,
      blobUrl: url,
      blobPathname: pathname,
      width: p.width,
      height: p.height,
      position: position++,
      caption: p.caption,
      originalSha256: sha,
      takenAt: p.takenAt,
      gpsLat: p.gps?.lat ?? null,
      gpsLng: p.gps?.lng ?? null,
    });
    existing.add(sha);
    result.added++;
  }

  if (result.added > 0) {
    // pins are fog-aware and only written by republish
    await republish(activityId);
    await invalidateCache("activities_list", "activities_latest");
  }
  return result;
}

// adding a photo on strava sends no webhook, so the daily cron re-checks recent
// activities that report photos and imports any that are new
export async function syncRecentStravaPhotos(
  token: string,
  findRowId: (stravaId: number, startDate: string) => Promise<number | null>,
  { days = 14 } = {}
): Promise<{ checked: number; added: number; failures: number }> {
  const after = Math.floor((Date.now() - days * 86400000) / 1000);
  const res = await fetch(`${API}/athlete/activities?after=${after}&per_page=100`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`strava activity list: ${res.status}`);
  const list = (await res.json()) as { id: number; start_date: string; total_photo_count?: number }[];
  const out = { checked: 0, added: 0, failures: 0 };
  for (const a of list) {
    if (!a.total_photo_count) continue;
    const rowId = await findRowId(a.id, a.start_date);
    if (rowId === null) continue;
    out.checked++;
    try {
      out.added += (await importStravaPhotos(rowId, a.id, token)).added;
    } catch (error) {
      out.failures++;
      log.warn("strava:photos", `import failed for ${a.id}`, error);
    }
  }
  return out;
}
