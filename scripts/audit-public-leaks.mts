// public leak audit. always read-only: selects, GETs of public photo urls, a
// LIST of the public bucket, optional GETs of the live site and a redis GET.
//
//   npx tsx --env-file=.env.local scripts/audit-public-leaks.mts \
//     [--site https://andrewzhou.org] [--kv] [--no-photos] [--concurrency 6]
//
// checks every public activity as the serializer would serve it: polyline +
// card polyline (all segments), bounds corners, fog edge points and photo pins
// against the enabled, non-archived privacy zones (strictly inside = leak,
// within the edge buffer = warning); every straight line drawn between
// consecutive points of a segment touching a zone (leak); any published zone
// shape (leak); fog events with entry/exit points (warning); private keys;
// the hide-map / hide-hr promises. downloads each public photo
// and flags exif/gps metadata. counts originals still in the public bucket
// under activities/fit/ (warning; deleting them is the owner's call).
// --site runs the same checks on the served json (/api/activities, /latest,
// /api/activities/<id> for every public id; private ids must 404). --kv checks
// the cached activities_list entry. works on a db that's behind the schema
// (missing columns read as defaults). exits 1 on any leak.

import { neon } from "@neondatabase/serverless";
import { asc } from "drizzle-orm";
import { getDb } from "../src/lib/db";
import { activities, activityPhotos, type ActivityRow } from "../src/lib/db/schema";
import { fillActivityRow, presentActivityColumns, type LegacyActivityRow } from "../src/lib/republish-legacy";
import {
  isPublic,
  publicActivityDetail,
  publicCalendarActivity,
  publicStartUtc,
  type PublicPhotoInput,
} from "../src/lib/public-activity";
import { isValidPolygon, type ZoneInput } from "../src/lib/privacy/fog";
import {
  checkPhotoMetadata,
  checkPublicActivity,
  checkPublicOriginals,
  checkVisibility,
  findPrivateKeys,
  imageFormat,
  photoMetadata,
  summarize,
  type Finding,
} from "../src/lib/privacy/leak-audit";
import { r2BucketList } from "../src/lib/r2";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string) => process.argv.includes(`--${name}`);

const site = arg("site")?.replace(/\/$/, "");
const checkKv = has("kv");
const checkPhotos = !has("no-photos");
const CONCURRENCY = Math.max(1, Number(arg("concurrency") ?? 6));

const findings: Finding[] = [];
const notes: string[] = [];
const add = (fs: Finding[]) => findings.push(...fs);

async function pool<T>(items: T[], fn: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      for (let item = queue.shift(); item !== undefined; item = queue.shift()) await fn(item);
    })
  );
}

// ---------------------------------------------------------------------------
// schema (read-only)

const sql = neon(process.env.DATABASE_URL!);
const tables = new Set(
  (
    await sql`
      select table_name from information_schema.tables
      where table_schema = 'public' and table_name in ('privacy_zones', 'activity_photos')`
  ).map((r) => r.table_name as string)
);
const columnsOf = async (table: string) =>
  new Set(
    (
      await sql`select column_name from information_schema.columns where table_schema = 'public' and table_name = ${table}`
    ).map((r) => r.column_name as string)
  );
const activityCols = await columnsOf("activities");
const zoneCols = await columnsOf("privacy_zones");
const photoCols = await columnsOf("activity_photos");
const hasPins = photoCols.has("pin_lat") && photoCols.has("pin_lng");

console.log(`audit-public-leaks — read-only${site ? `, site ${site}` : ""}${checkKv ? ", kv" : ""}${checkPhotos ? "" : ", photos skipped"}`);

// ---------------------------------------------------------------------------
// zones

let zones: ZoneInput[] = [];
if (tables.has("privacy_zones")) {
  const hasArchived = zoneCols.has("archived_at");
  const zoneRows = (await sql.query(
    `select id, polygon, enabled${hasArchived ? ", archived_at" : ""} from privacy_zones order by id`
  )) as { id: number | string; polygon: unknown; enabled: boolean; archived_at?: string | null }[];
  const active = zoneRows.filter((z) => z.enabled && !z.archived_at);
  for (const z of active) {
    if (!isValidPolygon(z.polygon)) {
      findings.push({ severity: "warning", where: `zone ${z.id}`, message: "invalid polygon: not checked against" });
    }
  }
  zones = active.filter((z) => isValidPolygon(z.polygon)).map((z) => ({ id: Number(z.id), polygon: z.polygon as number[][][] }));
  notes.push(`zones: ${zones.length} enabled${hasArchived ? ", non-archived" : " (no archived_at column)"} of ${zoneRows.length}`);
} else {
  notes.push("zones: privacy_zones table missing — none");
}

// ---------------------------------------------------------------------------
// rows, as the serializer serves them

const db = getDb();
const cols = presentActivityColumns(activityCols);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rawRows = (await db.select(cols as any).from(activities).orderBy(asc(activities.id))) as unknown as LegacyActivityRow[];
const allRows: ActivityRow[] = rawRows.map((r) => fillActivityRow(r));
const publicRows = allRows.filter(isPublic);
const privateIds = allRows.filter((r) => !isPublic(r)).map((r) => r.id);
const publicById = new Map(publicRows.map((r) => [r.id, r]));
notes.push(
  `activities: ${allRows.length} (public ${publicRows.length}, private ${privateIds.length}, ` +
    `map hidden ${publicRows.filter((r) => r.mapHidden).length}, hr hidden ${publicRows.filter((r) => r.hrHidden).length}, ` +
    `coarsened start ${publicRows.filter((r) => r.publishedStartUtc && r.publishedStartUtc.getTime() !== r.startDateUtc.getTime()).length})`
);

const photosByActivity = new Map<number, PublicPhotoInput[]>();
if (tables.has("activity_photos")) {
  const photoRows = await db
    .select({
      activityId: activityPhotos.activityId,
      blobUrl: activityPhotos.blobUrl,
      width: activityPhotos.width,
      height: activityPhotos.height,
      caption: activityPhotos.caption,
      ...(hasPins ? { pinLat: activityPhotos.pinLat, pinLng: activityPhotos.pinLng } : {}),
    })
    .from(activityPhotos)
    .orderBy(asc(activityPhotos.activityId), asc(activityPhotos.position));
  for (const p of photoRows) {
    const list = photosByActivity.get(p.activityId) ?? [];
    list.push({
      blobUrl: p.blobUrl,
      width: p.width,
      height: p.height,
      caption: p.caption,
      pinLat: "pinLat" in p ? (p.pinLat as number | null) : null,
      pinLng: "pinLng" in p ? (p.pinLng as number | null) : null,
    });
    photosByActivity.set(p.activityId, list);
  }
}
if (!hasPins) notes.push("photo pins: columns missing — none served");

for (const row of publicRows) {
  const where = `activity ${row.id}`;
  const detail = publicActivityDetail(row, photosByActivity.get(row.id) ?? []);
  add(checkPublicActivity(detail, zones, where));
  add(checkVisibility(detail as unknown as Record<string, unknown>, row, where));
  // the list item: private keys plus its card polyline's points and drawn lines
  add(checkPublicActivity(publicCalendarActivity(row) as unknown as Record<string, unknown>, zones, `${where} (list item)`));
}

// ---------------------------------------------------------------------------
// photo metadata

let photoCount = 0;
let photoErrors = 0;
const formats: Record<string, number> = {};
if (checkPhotos) {
  const photos = publicRows.flatMap((r) => (photosByActivity.get(r.id) ?? []).map((p) => ({ id: r.id, url: p.blobUrl })));
  await pool(photos, async ({ id, url }) => {
    const where = `activity ${id} photo ${url.split("/").pop()}`;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        findings.push({ severity: "warning", where, message: `GET ${res.status}` });
        photoErrors++;
        return;
      }
      const bytes = new Uint8Array(await res.arrayBuffer());
      photoCount++;
      const fmt = imageFormat(bytes);
      formats[fmt] = (formats[fmt] ?? 0) + 1;
      add(checkPhotoMetadata(await photoMetadata(bytes), where));
    } catch (error) {
      photoErrors++;
      findings.push({ severity: "warning", where, message: `could not check metadata: ${(error as Error).message}` });
    }
  });
  const fmts = Object.entries(formats).map(([k, v]) => `${k} ${v}`).join(", ");
  notes.push(`photos: ${photoCount} downloaded and checked${fmts ? ` (${fmts})` : ""}${photoErrors ? `, ${photoErrors} failed` : ""}`);
}

// ---------------------------------------------------------------------------
// originals in the public bucket

if (process.env.R2_BUCKET) {
  try {
    const keys = await r2BucketList(process.env.R2_BUCKET, "activities/fit/");
    add(checkPublicOriginals(keys, `${process.env.R2_BUCKET}/activities/fit/`));
    notes.push(`public bucket: ${keys.length} object(s) under activities/fit/`);
  } catch (error) {
    findings.push({ severity: "warning", where: "public bucket", message: `list failed: ${(error as Error).message}` });
  }
} else {
  notes.push("public bucket: R2_BUCKET not set — skipped");
}

// ---------------------------------------------------------------------------
// served json

// a served list item / detail against the row it came from
function checkServed(item: Record<string, unknown>, where: string, detail: boolean): void {
  const id = Number(item.id);
  const row = publicById.get(id);
  if (!row) {
    findings.push({ severity: "leak", where, message: `serves activity ${item.id}, which is not public` });
    return;
  }
  // list items carry the card polyline: same point + drawn-line checks as a detail
  add(checkPublicActivity(item, zones, detail ? where : `${where} (list item)`));
  add(checkVisibility(item, row, where));
  // a coarsened start must never be served raw
  const raw = row.localTime;
  const published = row.publishedLocalTime;
  if (published && published !== raw && item.startTime === raw) {
    findings.push({ severity: "leak", where, message: "serves the raw start time instead of the coarsened one" });
  }
}

async function getJson(path: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${site}${path}`, { headers: { accept: "application/json" } });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

if (site) {
  try {
    const list = await getJson("/api/activities");
    const items = ((list.body as { activities?: unknown[] })?.activities ?? []) as Record<string, unknown>[];
    if (list.status !== 200) findings.push({ severity: "warning", where: "/api/activities", message: `status ${list.status}` });
    items.forEach((it, i) => checkServed(it, `/api/activities [${i}] #${it.id}`, false));
    const servedIds = new Set(items.map((it) => Number(it.id)));
    const unserved = publicRows.filter((r) => !servedIds.has(r.id)).length;
    notes.push(`site list: ${items.length} item(s)${unserved ? `, ${unserved} public row(s) not in it (cache lag?)` : ""}`);

    const latest = await getJson("/api/activities/latest");
    const l = latest.body as Record<string, unknown> | null;
    if (l && typeof l === "object") {
      for (const k of findPrivateKeys(l)) findings.push({ severity: "leak", where: "/api/activities/latest", message: `private key "${k}" is served` });
      const row = publicById.get(Number(l.id));
      if (!row) findings.push({ severity: "leak", where: "/api/activities/latest", message: `serves activity ${l.id}, which is not public` });
      else if (
        row.publishedStartUtc &&
        row.publishedStartUtc.getTime() !== row.startDateUtc.getTime() &&
        l.startDate === row.startDateUtc.toISOString()
      ) {
        findings.push({ severity: "leak", where: "/api/activities/latest", message: "serves the raw start instead of the coarsened one" });
      } else if (row && l.startDate !== publicStartUtc(row).toISOString()) {
        findings.push({ severity: "warning", where: "/api/activities/latest", message: `startDate ${String(l.startDate)} ≠ published ${publicStartUtc(row).toISOString()} (cache lag?)` });
      }
    }

    let detailOk = 0;
    await pool(publicRows, async (row) => {
      const where = `/api/activities/${row.id}`;
      const res = await getJson(where);
      const a = (res.body as { activity?: Record<string, unknown> })?.activity;
      if (res.status !== 200 || !a) {
        findings.push({ severity: "warning", where, message: `status ${res.status}` });
        return;
      }
      detailOk++;
      checkServed(a, where, true);
    });
    notes.push(`site detail: ${detailOk}/${publicRows.length} fetched`);

    await pool(privateIds, async (id) => {
      const where = `/api/activities/${id}`;
      const res = await getJson(where);
      const a = (res.body as { activity?: unknown })?.activity;
      if (res.status !== 404 || a) findings.push({ severity: "leak", where, message: `private activity served (status ${res.status})` });
    });
    notes.push(`site private: ${privateIds.length} id(s) checked for 404`);
  } catch (error) {
    findings.push({ severity: "warning", where: site, message: `site check failed: ${(error as Error).message}` });
  }
}

// ---------------------------------------------------------------------------
// kv copy of the list

if (checkKv) {
  try {
    const { Redis } = await import("@upstash/redis");
    const redis = new Redis({ url: process.env.KV_REST_API_URL!, token: process.env.KV_REST_API_TOKEN! });
    const entry = await redis.get<{ data?: unknown; fetchedAt?: number }>("activities_list");
    if (!entry) {
      notes.push("kv activities_list: empty");
    } else {
      const items = (Array.isArray(entry.data) ? entry.data : []) as Record<string, unknown>[];
      items.forEach((it, i) => checkServed(it, `kv activities_list [${i}] #${it.id}`, false));
      notes.push(`kv activities_list: ${items.length} item(s), fetched ${entry.fetchedAt ? new Date(entry.fetchedAt).toISOString() : "?"}`);
    }
  } catch (error) {
    findings.push({ severity: "warning", where: "kv", message: `read failed: ${(error as Error).message}` });
  }
}

// ---------------------------------------------------------------------------
// report

console.log("");
for (const n of notes) console.log(`  ${n}`);
const { leaks, warnings } = summarize(findings);
const MAX = 100;
for (const severity of ["leak", "warning"] as const) {
  const list = findings.filter((f) => f.severity === severity);
  if (!list.length) continue;
  console.log(`\n${severity}s (${list.length}):`);
  for (const f of list.slice(0, MAX)) console.log(`  ${f.where}: ${f.message}`);
  if (list.length > MAX) console.log(`  … ${list.length - MAX} more`);
}
console.log(`\n${leaks} leak(s), ${warnings} warning(s). nothing was written.`);
process.exit(leaks ? 1 : 0);
