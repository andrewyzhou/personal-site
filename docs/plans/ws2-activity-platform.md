# WS2 — self-hosted activity platform

branch: `replace-strava`. replaces the dead strava api (403 "application inactive", history wiped — see PLAN.md §2.1) with a self-hosted pipeline: garmin .fit upload on a phone-friendly `/admin`, postgres (neon) as system of record, vercel blob for originals + photos, redis strictly cache-aside, and public read apis shape-compatible with the old `/api/strava*` responses so `Currently.tsx` and `ActivityCalendar.tsx` rewire with minimal diffs.

everything here builds on real code in this repo: the `getCachedData` pattern in `src/lib/cache.ts` (stale-on-failure already built in ws0), the structured logger `src/lib/log.ts`, the shape guards in `src/lib/validate.ts`, the `card-bg` / `link-highlight` / `--theme-*` css system in `src/app/globals.css`, the view-state machine in `src/components/ActivityCalendar.tsx`, and the detail-page pattern in `src/app/library/[slug]/page.tsx`.

## overview (goals, non-goals)

**goals**

1. minimal `/admin` shell: auth.js (next-auth v5) google sign-in, admin = email allowlist (`andrew06zhou@gmail.com`), pwa manifest so it installs to a phone home screen, minimal lowercase nav. ws3 builds the full cms on this shell.
2. phone-first activity upload: accept `.zip` (garmin "export original"), `.fit`, `.fit.gz`, `.gpx`, `.tcx` → server-side unzip + parse with the official garmin fit sdk → preview with stats + route → interactive start/end privacy trim → publish to neon. original file retained untouched in blob.
3. activity photos: client-side heic→jpeg downscale (~2000px), vercel blob client upload, carousel on the detail page and a thumbnail strip in the calendar detail card.
4. public read apis `/api/activities` and `/api/activities/latest`, byte-level shape-compatible with today's `/api/strava/activities` and `/api/strava` responses; redis cache-aside with explicit invalidation on publish; postgres is the only system of record.
5. rewire `Currently.tsx` + `ActivityCalendar.tsx` to the new endpoints with minimal diffs (a handful of lines each; no restyling).
6. activity detail page `/activities/[id]`: maplibre + openfreemap route map with svg fallback, stat grid, photo carousel, back link — mirroring the library detail page layout.
7. inline svg route thumbnails (zero deps: own polyline decoder + douglas-peucker).
8. idempotent local bulk-import script for the strava account archive (`.fit.gz` + `activities.csv`), never destructive.
9. intervals.icu "pull latest" designed now (endpoints, env, flow), built in phase 2.

**non-goals**

- no full cms (ws3), no comments/likes/claps/views (ws5), no unified multi-month calendar (ws3).
- no full time-series stream storage (hr/power charts). the original .fit is retained in blob, so streams are always re-derivable; charts are a future increment. summary stats only.
- no exif extraction from photos in this workstream. the canvas re-encode deliberately strips exif (privacy win: no gps coordinates near home embedded in served photos). photo-essay exif sidebar is ws6 and operates on a different section.
- no restyling of any existing component. blog and photos stay entirely separate — activities is a third, independent surface.
- no deletion of strava code. `src/lib/strava.ts` and all `/api/strava*` routes stay exactly as they are, dormant behind `STRAVA_API_ENABLED` (already no-op: `getAllActivities`/`getLatestActivity` return empty when the flag is off). the only strava-file change is that new code *imports the pure formatters* (`formatDistance`, `formatDuration`, `formatTimeAgo`) from `src/lib/strava.ts` — these touch no api and keep formatting identical.

## data model

### postgres (neon), managed by drizzle

**client choice: `drizzle-orm` on top of `@neondatabase/serverless` (neon-http driver).** justification:

- `@neondatabase/serverless` `neon()` speaks http/fetch to neon's sql proxy — no tcp pools, no connection exhaustion on vercel serverless, works in node runtime route handlers and in the local import script identically.
- drizzle adds typed rows (the `activities` row type maps 1:1 onto the existing `CalendarActivity` interface, making the calendar rewire mechanical and compile-checked), and `drizzle-kit` generates plain sql migration files committed to `drizzle/` — migrations live in git, which fits the "git is system of record for authored things" ethos and gives ws5 (comments/likes/claps/views tables) a ready migration path.
- raw sql alone was considered and rejected: three more workstreams add tables to this database; hand-rolled migration tracking is the first thing that rots.
- transactions: the neon-http driver is single-statement; publish inserts the activity row first, then photos (photo insert failure is logged and recoverable via PATCH — see failure modes). no interactive transactions needed anywhere in this design.

**migration tooling:** `drizzle-kit generate` (sql files into `drizzle/`, committed) + `drizzle-kit migrate` run locally against neon via `npm run db:migrate`. one-person project: migrations are applied manually before deploying code that needs them; no ci migration step. `drizzle.config.ts` at repo root: `dialect: "postgresql"`, `schema: "./src/lib/db/schema.ts"`, `out: "./drizzle"`, `dbCredentials: { url: process.env.DATABASE_URL }`.

**ddl (migration 0000):**

```sql
create table activities (
  id                bigint generated always as identity primary key,
  name              text not null default '',
  sport_type        text not null,                      -- strava-style keys: Run, Ride, WeightTraining… (matches ACTIVITY_ICONS in ActivityCalendar.tsx)
  start_date_utc    timestamptz not null,
  local_date        text not null,                      -- 'YYYY-MM-DD' (mirrors CalendarActivity.date)
  local_time        text not null,                      -- 'HH:MM'     (mirrors CalendarActivity.startTime)
  utc_offset_min    integer not null default 0,
  -- published (post-trim) stats
  distance_m        double precision not null default 0,
  moving_time_s     integer not null default 0,
  elapsed_time_s    integer not null default 0,
  elev_gain_m       double precision not null default 0,
  avg_speed_ms      double precision not null default 0,
  max_speed_ms      double precision not null default 0,
  avg_hr            double precision,                   -- null = not recorded
  max_hr            double precision,
  avg_cadence       double precision,                   -- stored raw as the device reports it
  avg_watts         double precision,
  max_watts         double precision,
  kilojoules        double precision,
  description       text,
  suffer_score      double precision,                   -- imported strava "relative effort" only; null for new uploads
  gear              text,                               -- free text, e.g. 'pegasus 41'
  -- published route (post-trim)
  polyline          text,                               -- google encoded polyline, precision 5, rdp ≤ 1500 pts (detail page)
  card_polyline     text,                               -- same encoding, rdp ≤ 100 pts (svg thumbnails)
  bounds            jsonb,                              -- {"minLat":…,"minLng":…,"maxLat":…,"maxLng":…} of the PUBLISHED route
  trim_start_m      double precision not null default 0,
  trim_end_m        double precision not null default 0,
  -- original file (never trimmed, never mutated)
  fit_blob_url      text,
  fit_blob_pathname text,
  fit_sha256        text,
  file_type         text,                               -- 'fit' | 'gpx' | 'tcx' | null (csv-only manual imports)
  source            text not null default 'upload',     -- 'upload' | 'strava-archive' | 'intervals-icu' | 'manual'
  external_id       text,                               -- strava activity id or intervals.icu id, as text
  dedupe_key        text not null,                      -- sha256(`${startEpochSec}:${elapsedTimeS}`) — pre-trim values
  hidden            boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint activities_dedupe_key_unique unique (dedupe_key)
);
create unique index activities_external_id_idx on activities (external_id) where external_id is not null;
create index activities_local_date_idx on activities (local_date desc);
create index activities_start_date_idx on activities (start_date_utc desc);

create table activity_photos (
  id            bigint generated always as identity primary key,
  activity_id   bigint not null references activities(id) on delete cascade,
  blob_url      text not null,
  blob_pathname text not null,
  width         integer,
  height        integer,
  position      integer not null default 0,
  caption       text,
  created_at    timestamptz not null default now()
);
create index activity_photos_activity_idx on activity_photos (activity_id, position);
```

notes:

- `id` is an app-owned identity (serializes as a js number; safe range for centuries). imported strava ids go in `external_id`, not `id` — old `strava.com/activities/…` urls are dead anyway.
- `dedupe_key` uses **pre-trim** start epoch + elapsed seconds so re-uploading the same fit (or re-running the import) always collides regardless of trim settings. all inserts are `on conflict (dedupe_key) do nothing` — the ws0 lesson (never delete-before-write, imports idempotent) is enforced at the schema level.
- `CalendarActivity` mapping (`rowToCalendarActivity` in `src/lib/activities.ts`): `id→id (Number)`, `name→name`, `sport_type→type`, `local_date→date`, `local_time→startTime`, `distance_m→distance`, `moving_time_s→duration`, `elapsed_time_s→elapsedTime`, `elev_gain_m→totalElevationGain`, `avg_speed_ms→averageSpeed`, `max_speed_ms→maxSpeed`, `avg_hr→averageHeartrate`, `max_hr→maxHeartrate`, `avg_cadence→averageCadence`, `avg_watts→averageWatts`, `max_watts→maxWatts`, `kilojoules→kilojoules`, `description→description`, `suffer_score→sufferScore`. every field of the existing interface in `src/lib/strava.ts:58-78` is covered.

### vercel blob layout

```
activities/fit/{yyyy}/{fit_sha256}.{fit|gpx|tcx}     -- originals, addRandomSuffix: false (content-addressed, naturally idempotent)
activities/photos/{yyyy}/{random-suffix}.jpg          -- downscaled jpegs, addRandomSuffix: true
```

photos are ~300–500 KB after mandatory client downscale; fit originals are 100 KB–2 MB. at that rate the 1 GB hobby ceiling holds years of data; the store-size audit (below) alarms at 700 MB.

### fit sport → sport_type mapping (in `src/lib/fit.ts`)

| fit sport (subSport) | sport_type |
|---|---|
| running | Run |
| running (trail) | TrailRun |
| running (virtual_activity) | VirtualRun |
| cycling | Ride |
| cycling (virtual_activity) | VirtualRide |
| cycling (mountain) | MountainBikeRide |
| cycling (gravel_cycling) | GravelRide |
| swimming | Swim |
| walking | Walk |
| hiking | Hike |
| training (strength_training) | WeightTraining |
| training / fitness_equipment | Workout |
| yoga | Yoga |
| tennis | Tennis |
| soccer | Soccer |
| rock_climbing | RockClimbing |
| anything else | Workout |

these are exactly the keys `ACTIVITY_ICONS` / `ACTIVITY_NAMES` / `DURATION_TYPES` / `PACE_TYPES` / `SPEED_TYPES` / `DISTANCE_TYPES` in `ActivityCalendar.tsx` already handle — no component changes needed for type handling.

### derived-data algorithms (in `src/lib/geo.ts`, pure, no deps)

- **cumulative distance**: haversine over consecutive gps records.
- **trim**: given `trimStartM`/`trimEndM`, keep records with `trimStartM ≤ cumDist ≤ total − trimEndM`.
- **published stats recompute over kept records**: distance = last kept cumDist − first kept cumDist; elapsed = t(last) − t(first); moving = Σ consecutive deltas ≤ 10 s (gaps are pauses); avg speed = distance/moving; avg/max hr, cadence, watts = mean/max over kept records that carry the field; elevation gain = Σ positive deltas of `enhancedAltitude` after a 5-sample moving average. when trim is 0/0, session-message totals from the fit are used verbatim (no recompute drift).
- **douglas-peucker** (`rdpReduce(points, maxPoints)`): binary-search epsilon until ≤ maxPoints. 1500 for `polyline`, 100 for `card_polyline`.
- **polyline codec** (`src/lib/polyline.ts`): google encoded polyline algorithm, precision 5, ~30 lines each direction, zero deps.

## api surface

failure envelope convention (matches ws0-normalized behavior): public GETs degrade to the **same shape with empty/null data** and never crash a widget; admin routes return `{ ok: false, error: "<lowercase human message>" }` with an appropriate status. all handlers log via `src/lib/log.ts` with a `source` tag before responding.

### auth

| method/path | auth | notes |
|---|---|---|
| `GET/POST /api/auth/[...nextauth]` | public | next-auth v5 handlers (`export const { GET, POST } = handlers`). google provider. **signIn callback allows any google account** — admin gating happens at page/route level, because ws5 reuses this sign-in for public users. jwt session strategy, no db adapter. the jwt/session callbacks stamp `isAdmin = ADMIN_EMAILS.split(",").includes(email)`. |

`src/lib/admin-auth.ts` changes: `isAdminRequest(request)` becomes `async` — checks `(await auth())?.user` against the allowlist first, then falls back to the existing `x-admin-secret` header (keeps curl ops and existing tests working). state-changing admin routes additionally verify the `origin` header matches the site origin (cheap csrf hardening on top of lax cookies). the five ws0 call sites (`/api/cache/clear`, `/api/strava/refresh`, `/api/strava/activities` POST, `/api/strava/activities/full-refresh`, `/api/github/leetcode` POST) each gain one `await`.

### public reads

**`GET /api/activities`** — public. replaces `/api/strava/activities` for `ActivityCalendar`.

```jsonc
// 200 — identical shape to today's response
{ "activities": [ /* CalendarActivity[] — full history, date desc, NO polylines (payload parity with today) */ ],
  "lastFetchedAt": 1751830000000 }
// db+cache both dead: 500, body { "activities": [], "lastFetchedAt": null }  (identical to current failure behavior)
```

caching: `getCachedData("activities_list", fetchFromDb)` — add `activities_list: 5 * 60 * 1000` to `CACHE_TTL` in `src/lib/cache.ts`. postgres is source of truth; redis is cache-aside; the existing stale-on-failure path serves last-good data through a neon outage for up to the 7-day safety ttl. publish/edit/delete explicitly `redis.del("activities_list", "activities_latest")` so new uploads appear immediately despite the ttl.

**`GET /api/activities/latest`** — public. replaces `/api/strava` for `Currently`.

```jsonc
// 200 — passes isStravaActivity() in src/lib/validate.ts unchanged
{ "id": 123, "name": "morning run", "type": "Run",
  "distance": 8368.2, "movingTime": 2400, "elapsedTime": 2520,
  "startDate": "2026-07-06T14:12:00.000Z",
  "latestActivityId": 123,
  "formattedDistance": "5.2 mi",          // formatDistance(distance_m)      — imported from src/lib/strava.ts
  "formattedDuration": "42 min",          // formatDuration(elapsed_time_s)  — elapsed, matching old /api/strava behavior
  "formattedTimeAgo": "yesterday",        // formatTimeAgo(startDate)
  "fetchedAt": 1751830000000, "previousFetchedAt": null, "stale": false }
// no activities in db: 200, body null            (matches old contract; Currently already handles it)
// db+cache dead: 500, body null
```

caching: `getCachedData("activities_latest", …)`, ttl 1 min.

**`GET /api/activities/[id]`** — public. new; feeds the calendar detail card's lazy enhancement and anything else needing route/photos.

```jsonc
// 200
{ "activity": { /* CalendarActivity fields */,
    "polyline": "…|null", "cardPolyline": "…|null",
    "bounds": {"minLat":0,"minLng":0,"maxLat":0,"maxLng":0} ,
    "gear": "pegasus 41",
    "photos": [ { "url": "https://….jpg", "width": 2000, "height": 1500 } ] } }
// unknown or hidden id: 404, body { "activity": null }
```

`force-dynamic`, no redis (per-id, low traffic, publish-time revalidation covers the detail page).

### admin mutations (all: session-admin required via `requireAdmin`, node runtime)

**`POST /api/admin/activities/parse`** — `maxDuration = 60`. two request forms:

1. `multipart/form-data` with `file` (≤ 4 MB — the normal path; garmin "export original" zips and bare .fit files are 100 KB–2 MB).
2. `application/json` `{ "blobUrl": "https://…" }` — fallback for files over 4 MB (verbose multi-hour .gpx can exceed vercel's hard 4.5 MB request cap). the client uploads to blob first via the client-upload route, then points the parser at it.

**decision & justification:** route-handler multipart is the primary path because the server must hold the raw bytes anyway (unzip + garmin-fit-sdk decode), fit files are far below the 4.5 MB cap, and it is one round trip with atomic error handling. the blob-pointer fallback reuses machinery the photo flow requires regardless, so oversized gpx costs ~15 extra lines, not a second architecture.

behavior: detect container (`.zip` → fflate unzip, expect exactly one track file — if several, 422 listing entries; `.gz` → gunzip), sha256 the track bytes, **immediately `put()` the original to blob** at `activities/fit/{yyyy}/{sha256}.{ext}` (originals are retained no matter what happens next; content-addressed path makes re-parse idempotent), decode (fit via sdk; gpx/tcx via xmldom+togeojson), compute stats + compact preview track, check `dedupe_key` against the db.

```jsonc
// 200
{ "ok": true, "draft": {
    "fitBlobUrl": "…", "fitSha256": "…", "fileType": "fit",
    "sportType": "Run", "suggestedName": "morning run",       // from local time-of-day + sport
    "startDateUtc": "…", "localDate": "2026-07-06", "localTime": "07:12", "utcOffsetMin": -420,
    "stats": { "distanceM": 0, "movingTimeS": 0, "elapsedTimeS": 0, "elevGainM": 0,
               "avgSpeedMs": 0, "maxSpeedMs": 0, "avgHr": null, "maxHr": null,
               "avgCadence": null, "avgWatts": null, "maxWatts": null, "kilojoules": null },
    "track": { "points": [[lat, lng, cumDistM, tOffsetS, eleM], …] } ,   // rdp ≤ 2000 pts; null for non-gps activities
    "duplicate": { "id": 88, "name": "morning run", "date": "2026-07-05" }  // or null
} }
// failures: 400 unsupported extension · 413 too large for multipart (client falls back to blob path)
// 422 { ok:false, error:"could not decode fit file: …" } · 401 unauthorized · 502 blob write failed
```

**`POST /api/admin/activities`** (publish) — `maxDuration = 60`. stateless and authoritative: the server re-fetches the original from `fitBlobUrl`, re-parses, applies the trim itself, and recomputes all published stats — the client's preview numbers are never trusted.

```jsonc
// request
{ "fitBlobUrl": "…", "fileType": "fit",
  "name": "morning run", "description": null, "sportType": "Run", "gear": null,
  "trimStartM": 200, "trimEndM": 200,
  "photos": [ { "blobUrl": "…", "pathname": "…", "width": 2000, "height": 1500 } ] }
// 201: { "ok": true, "id": 123, "url": "/activities/123" }
// 409: { "ok": false, "error": "duplicate activity", "id": 88 }        (dedupe_key conflict)
// 422 parse/validation failure · 401 · 503 { ok:false, error:"database unavailable" }
```

on success: insert row (`on conflict do nothing`, re-select to distinguish 201/409), insert photo rows, `redis.del("activities_list","activities_latest")`, `revalidatePath("/activities/" + id)`, `log.info("admin:publish", …)` with id + dedupe key.

**`PATCH /api/admin/activities/[id]`** — body: any of `{ name, description, sportType, gear, hidden, trimStartM, trimEndM, photos }`. if trim values change and `fit_blob_url` exists, re-fetch + re-parse + recompute published polyline/stats (same code path as publish). if `photos` present, replace the photo rows (delete+insert; blobs themselves are only deleted by DELETE below). 200 `{ ok: true }`; 404; 401. invalidates the same caches.

**`DELETE /api/admin/activities/[id]`** — soft by default: sets `hidden = true` (never destructive, per the ws0 lesson). `?hard=true` additionally deletes the row, photo rows, and photo blobs (fit original is kept). 200 `{ ok: true }`.

**`POST /api/admin/blob`** — vercel blob client-upload token endpoint (`handleUpload` from `@vercel/blob/client`). `onBeforeGenerateToken` **must authenticate** (session-admin; this is the documented mandatory check) and returns per-kind constraints from `clientPayload.kind`: `photo` → `allowedContentTypes: ["image/jpeg","image/webp"]`, `maximumSizeInBytes: 3_000_000`, `addRandomSuffix: true`, pathname prefix `activities/photos/{yyyy}/`; `track` → `["application/octet-stream","application/gpx+xml","application/zip","application/gzip"]`, 30 MB, prefix `activities/fit/incoming/`. `onUploadCompleted` is a no-op log (it never fires on localhost; the design deliberately doesn't depend on it — the client carries blob urls into the publish POST).

**`GET /api/admin/storage`** — blob store audit: loops `list({ cursor })`, sums sizes, returns `{ ok: true, totalBytes, count, warning: totalBytes > 700_000_000 }`. `log.warn("admin:storage", …)` above 700 MB, `log.error` above 900 MB (the 1 GB hobby cliff cuts blob access for 30 days — this must never be a surprise).

**`POST /api/admin/intervals/pull`** — **phase 2, designed now, not built.** basic auth `("API_KEY", INTERVALS_ICU_API_KEY)` against `https://intervals.icu/api/v1/athlete/{INTERVALS_ICU_ATHLETE_ID}/activities?oldest={maxStartDateUtc − 1d}` → for each activity not matching an existing `dedupe_key`: `GET /api/v1/activity/{id}/file` (returns the original fit garmin delivered, possibly gzipped) → run the shared `publishFromTrackFile()` pipeline with the default privacy trim and auto-generated name, `source = 'intervals-icu'`, `external_id = i{id}`. cap 10 files per invocation (`maxDuration = 60`), return `{ ok: true, imported, skipped, failures: [{id, error}] }`. failure envelopes: 401 upstream → `{ ok:false, error:"intervals.icu rejected the api key" }`; 429 → stop and report partial. **implementation consequence for phase 1: parse/compute/publish logic must live in `src/lib/fit.ts` / `src/lib/activities.ts` as plain functions callable outside route handlers** (the import script needs this too).

### dormant strava coexistence

`/api/strava`, `/api/strava/activities(/full-refresh)`, `/api/strava/refresh`, `/api/strava/auth`, `/api/strava/callback` remain deployed and untouched. with `STRAVA_API_ENABLED` unset they already return null/empty without calling strava. nothing links to them after the rewire; they cost nothing and revive with one env flag if strava+ ever happens. the redis key `strava_activities` is abandoned in place (it contains an empty array; the import script recovers history from the archive instead).

## ui/ux

all new ui uses the existing vocabulary only: `font-sans`, `text-off-white` / `text-gray` / `text-secondary`, `card-bg`, `link-highlight`, `section-divider`, `--theme-*` variables, lowercase text everywhere, spacing via the same inline `style={{}}` idiom the codebase uses. no new colors, no new fonts, no new design language. error states are quiet gray italic text, matching the site's degraded-state convention.

### /admin (dashboard) — mobile-first, `site-container` with content capped at `maxWidth: 480px`

- **signed out**: centered `card-bg rounded-lg` card (`padding: 24px`): `admin` (h1, `font-sans font-bold text-off-white text-3xl`), below it a full-width `link-highlight rounded-lg` button `sign in with google` (server action calling `signIn("google")`).
- **signed in, not allowlisted**: same card: `not authorized` + `signed in as x@y.com` (`text-gray text-sm`) + `sign out` button.
- **admin**: header row `admin` + `sign out` (`text-gray text-sm link-highlight`). then, stacked with `gap: 12px`:
  - `+ upload activity` — full-width `card-bg rounded-lg` button, `padding: 20px`, links to `/admin/upload`. the primary phone action; big tap target.
  - `pull latest from intervals.icu` — rendered only when both `INTERVALS_ICU_*` env vars exist (phase 2; hidden until then).
  - `recent` list: last 10 activities from the db (server component, direct drizzle query — no api hop). each row mirrors the selector-row pattern from `StravaActivitySelector` (`link-highlight rounded-lg`, activity icon from `/icons/activities/`, name, `text-gray text-xs` metric · date), linking to `/admin/activities/[id]` (edit).
  - footer line: `blob store: 412 mb / 1 gb` (`text-gray text-xs`), from `/api/admin/storage`; turns into `blob store nearing limit — audit needed` (still gray italic, no red) past 700 MB.
- **pwa**: `src/app/admin/layout.tsx` sets segment metadata `manifest: "/admin-manifest.webmanifest"` and `appleWebApp: { capable: true, title: "az admin", statusBarStyle: "black-translucent" }`. `public/admin-manifest.webmanifest`: `{ name: "andrewzhou.org admin", short_name: "az admin", start_url: "/admin", display: "standalone", background_color: "#101010", theme_color: "#101010", icons: [192, 512 pngs] }`. the layout is also the auth gate (`await auth()`; renders sign-in/not-authorized states) — defense in depth: every mutation route still calls `requireAdmin` itself.

### /admin/upload — the upload flow (client component `UploadFlow.tsx`, one explicit state machine)

`type Phase = "pick" | "parsing" | "preview" | "publishing" | "done" | "error"` — same discriminated-union pattern as `StravaViewState` in `ActivityCalendar.tsx`.

1. **pick**: one large `card-bg rounded-lg` tap target (`padding: 48px 24px`, centered): `tap to select a file` + `text-gray text-xs` line `.fit · .zip (garmin export original) · .gpx · .tcx`. hidden `<input type="file" accept=".fit,.zip,.gpx,.tcx,.gz">`. on select: ≤ 4 MB → multipart POST to parse; > 4 MB → blob client upload (`upload()` from `@vercel/blob/client`, `clientPayload: {kind:"track"}`) then JSON POST. drag-and-drop also wired for desktop (same handler).
2. **parsing**: pulsing card (`card-bg animate-pulse`, like the calendar's loading state) with `parsing…`.
3. **preview** (the core screen, single column):
   - **route + trim** (gps activities only): maplibre `RouteMap` (~`aspectRatio: "16/10"`, `rounded-lg overflow-hidden card-bg`) showing two geojson line layers — full original track muted (`opacity 0.35`) and the published (kept) segment solid — with start/end markers. street context is the whole point: privacy trimming is guesswork without a basemap. svg fallback (`RouteThumb` with the same two-tone treatment) if tiles fail.
   - two native range sliders (`accent-color: var(--theme-text-primary)`, labels `text-gray text-sm`): `trim start — 0.12 mi`, `trim end — 0.12 mi`. range 0 … `min(5 km, 45% of distance)`, step 10 m. dragging filters the compact preview track by cumulative distance client-side and live-updates map + stat grid (pure array work, instant).
   - `privacy trim` — one-click `link-highlight rounded-lg` button setting both sliders to **200 m** (recommended default: matches strava's historical privacy-zone radius; enough to obscure a doorstep without visibly amputating a route).
   - **stats grid**: `grid grid-cols-3 gap-3`, identical markup pattern to `StravaActivityDetail` (value `text-off-white text-sm font-medium`, label `text-gray text-xs`) — time, distance, pace/speed (by type), elevation, avg hr, max hr, cadence, power when present. recomputes live with trim.
   - **fields**: name (`<input>` prefilled with `suggestedName`), sport type (`<select>` prefilled from mapping), gear (`<input>`, placeholder `gear notes`), description (`<textarea>`). inputs styled as `card-bg rounded-lg`, `font-sans text-off-white text-sm`, `padding: 8px 12px`, no borders beyond `1px solid var(--theme-highlight-bg)`.
   - **photos**: `add photos` button → `<input type="file" accept="image/*" multiple>`. per photo: heic detected → lazy `import("heic2any")` → decode; `createImageBitmap(file, { imageOrientation: "from-image" })` → canvas downscale to max edge 2000 px → `toBlob("image/jpeg", 0.85)` (jpeg, not webp: safari cannot encode webp via canvas) → blob client upload with per-photo status (`converting… / uploading… / ✓`) → thumbnail row (64 px squares, `rounded-lg`, × remove). max 10 photos. exif is stripped by re-encode by design.
   - **duplicate warning**: if `draft.duplicate`, gray italic banner `already published — view activity →` above a disabled publish button (override not offered; dedupe is the ws2.1-incident guardrail).
   - `publish` — full-width `card-bg rounded-lg` button, `padding: 14px`.
4. **publishing**: button text → `publishing…`, disabled.
5. **done**: `published` + `view activity →` (`link-highlight`, to `/activities/[id]`) + `upload another`.
6. **error** (any phase): the card shows `text-gray text-sm italic` message (e.g. `could not parse that file — is it a garmin original export?`) + `try again`. never a blank screen, never an uncaught throw.

### /admin/activities/[id] — edit (thin reuse)

loads the row (+ re-parses the original from blob when it exists) and renders the same preview component with values prefilled; save → PATCH. also `hide from site` toggle and `delete` (soft). this page exists so trim mistakes are fixable post-publish without re-uploading.

### /activities/[id] — public detail page (server component, mirrors `src/app/library/[slug]/page.tsx` structurally)

- `export const revalidate = 300`; publish/edit call `revalidatePath`. `notFound()` for missing/hidden ids. `generateMetadata`: `` `${name} · activity · andrew zhou` ``.
- `main.site-container` → `section.py-8` back link `← home` (`Link href="/"`, `font-sans text-gray text-base link-highlight`) → `article.py-8` with `style={{ maxWidth: "720px" }}`:
  - header: icon square exactly like the calendar detail (`w-10 h-10 rounded-lg`, `border: 1px solid var(--theme-highlight-bg)`, `/icons/activities/{icon}.svg`) beside `h1 font-sans font-bold text-off-white text-4xl` (name, lowercase as entered).
  - subline `text-gray text-lg`: `sunday, july 6 · 7:12 am · run` (+ ` · pegasus 41` when gear present).
  - `hr` divider (same inline style as the library page).
  - **map** (only when `polyline` exists — omitted entirely otherwise, no placeholder): `RouteMap` in a `rounded-lg overflow-hidden card-bg` block, `aspectRatio: "16/10"`, `margin: 2rem 0`. maplibre + openfreemap `positron` style, fit to `bounds` with 32 px padding, route drawn `#1a1a1a` width 3, non-interactive except pinch-zoom/drag, compact attribution control (osm attribution is legally required). dark theme: container gets `filter: invert(0.92) hue-rotate(180deg)` (canvas-safe, keeps the map monochrome and on-theme; swap to a native dark style if openfreemap ships one). fallback: if webgl is unavailable, `Map` construction throws, or `load` hasn't fired in 6 s → render `RouteThumb` svg in the same box, quietly.
  - **stat grid**: `grid grid-cols-3 gap-3` (wraps to more rows as stats exist): time, distance, avg pace|speed, elevation, avg hr, max hr, cadence, power, energy — value `text-off-white text-lg font-medium`, label `text-gray text-xs`, same presence rules as `StravaActivityDetail` (`DURATION_TYPES` etc.).
  - description paragraph `text-secondary text-base leading-relaxed` when present.
  - **photo carousel** when photos exist: horizontal `snap-x` scroll container of `rounded-lg` images (plain `<img loading="lazy">`, **not** `next/image` — photos are already downscaled to ≤2000 px / ~400 KB, so bypassing image optimization protects the 5k-transformations hobby quota and needs no `remotePatterns` config), with prev/next buttons reusing the existing `.photoset-nav-btn` class on wider screens.
- then `section-divider` + the standard `© andrew zhou 2025-2026` footer.

### svg route thumbnails (`src/components/RouteThumb.tsx`)

zero-dependency inline svg: decode `card_polyline` (own decoder), project equirectangular (`x = lng·cos(midLat)`, y = −lat), normalize into a `viewBox` with 5% padding, single `<path>` — `fill="none"`, `stroke="var(--theme-text-primary)"`, `strokeWidth={1.5}`, `vectorEffect="non-scaling-stroke"`, `strokeLinejoin="round"`, `strokeLinecap="round"`, `opacity={0.9}`. downsampling already happened at publish (rdp → ≤100 points), so render cost is trivial. note on the icon convention: static files in `public/icons/` keep `stroke="#EEEEEE"` (they're theme-flipped by the `theme-light img[src*="/icons/"]` invert filter in globals.css); this **inline** svg is not an `<img>` and never passes through that filter, so the css variable is the correct theming mechanism here.

### rewiring the two widgets (minimal diffs, no restyling)

`src/components/Currently.tsx` — 2 lines:
- `fetch("/api/strava")` → `fetch("/api/activities/latest")` (line ~126).
- workout link `https://www.strava.com/activities/${strava.id}` → `/activities/${strava.id}` (line ~399; the existing `isInternal` logic in `renderTextWithLinks` handles target/rel automatically).
- the `strava-latest-activity` custom event name and all internal variable names stay — renaming is churn with zero user-visible value.

`src/components/ActivityCalendar.tsx` — small, contained diffs:
- `fetch("/api/strava/activities")` → `fetch("/api/activities")` (both occurrences: initial load ~line 527 and event-driven refresh ~line 547).
- mode toggle icon: `src="/icons/strava.svg"` → `src="/icons/activity.svg"` (new file: a minimal pulse/heartbeat line, 16×16, `stroke="#EEEEEE"` per the icon convention, `fill="none"`); `alt="Strava"`→`alt="activities"`, `aria-label="Strava mode"`→`aria-label="activities mode"`. internal identifiers (`CalendarMode = "strava"`, `stravaData`, …) intentionally stay to keep the diff minimal — noted as accepted naming debt for ws3's unified calendar rewrite.
- `StravaActivityDetail`: replace the `view on strava →` anchor with `<Link href={`/activities/${activity.id}`}>view activity →</Link>` (same classes). plus one contained enhancement: a `useEffect` lazily fetching `/api/activities/${activity.id}`; when it resolves with a `cardPolyline`, render a `RouteThumb` (height ~80 px) above the stats grid, and when photos exist, a 48 px thumbnail strip below it. fetch failure = render nothing (quiet degrade). the list payload stays polyline-free so calendar load cost is identical to today.

## implementation plan

steps within a phase marked **[P]** are parallelizable with each other once phase A lands.

**phase A — foundations (sequential, blocks everything)**

1. **db plumbing**: add deps; create `drizzle.config.ts`, `src/lib/db/schema.ts` (drizzle mirror of the ddl above), `src/lib/db/index.ts` (`neon()` + `drizzle()` export). scripts in `package.json`: `db:generate`, `db:migrate`. run `drizzle-kit generate` → commit `drizzle/0000_*.sql`; create the neon project (same region as vercel functions, iad1/us-east) and migrate.
2. **auth**: `src/lib/auth.ts` (NextAuth: google provider, jwt sessions, `isAdmin` in jwt/session callbacks from `ADMIN_EMAILS`); `src/app/api/auth/[...nextauth]/route.ts`; extend `src/lib/admin-auth.ts` (async `isAdminRequest` = session-or-secret, `requireAdmin(request)` helper adding origin check); add the `await` at the five existing call sites. env on vercel: `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `ADMIN_EMAILS`, `DATABASE_URL`, `BLOB_READ_WRITE_TOKEN`.
3. **pure libs** (no framework imports — must run in node scripts too): `src/lib/polyline.ts` (encode/decode), `src/lib/geo.ts` (haversine, cumdist, rdp, trim, moving-time, elevation-gain), `src/lib/fit.ts` (fflate unzip/gunzip; `@garmin/fitsdk` `Stream.fromBuffer`/`Decoder` → normalized `{records, session, sport, subSport, localOffsetMin}` using `sessionMesgs[0]` totals, `recordMesgs` positions in semicircles × 180/2³¹, `enhancedAltitude`/`enhancedSpeed`, `activityMesgs[0].localTimestamp − timestamp` for tz; sport mapping table; `suggestedName`), `src/lib/gpx.ts` (xmldom + togeojson → same normalized shape), `src/lib/activities.ts` (`rowToCalendarActivity`, `dedupeKey`, `computePublished(track, trimStartM, trimEndM)`, `publishFromTrackFile(bytes, meta, db)` — the function the parse/publish routes, edit route, import script, and future intervals.icu pull all share).

**phase B — backend [P with C and D]**

4. public reads: `src/app/api/activities/route.ts`, `src/app/api/activities/latest/route.ts` (extend `CACHE_TTL` in `src/lib/cache.ts` with `activities_list`/`activities_latest`; import formatters from `src/lib/strava.ts`), `src/app/api/activities/[id]/route.ts`.
5. admin mutations: `src/app/api/admin/activities/parse/route.ts`, `src/app/api/admin/activities/route.ts` (publish), `src/app/api/admin/activities/[id]/route.ts` (PATCH/DELETE), `src/app/api/admin/blob/route.ts` (`handleUpload` with authenticated `onBeforeGenerateToken`), `src/app/api/admin/storage/route.ts` + `src/lib/blob-audit.ts`.

**phase C — admin ui [P with B: build against the api contracts above, integrate when B lands]**

6. shell: `src/app/admin/layout.tsx` (auth gate, nav, manifest/appleWebApp metadata), `src/app/admin/page.tsx` (dashboard, server component with direct drizzle reads), `public/admin-manifest.webmanifest`, `public/icons/admin-192.png` + `admin-512.png` (rendered from `public/images/logo.svg` on #101010).
7. upload flow: `src/components/admin/UploadFlow.tsx` (state machine), `src/components/admin/TrimControls.tsx` (sliders + privacy-trim button + live recompute), `src/lib/client/image.ts` (heic2any lazy import + canvas downscale/jpeg), `src/app/admin/upload/page.tsx`.
8. edit page: `src/app/admin/activities/[id]/page.tsx` reusing the preview component; wire PATCH/DELETE.

**phase D — public ui [P with B/C after step 3]**

9. `src/components/RouteThumb.tsx`; `public/icons/activity.svg`.
10. `src/components/RouteMap.tsx` (client component, dynamic `import("maplibre-gl")` + css import, fitBounds, two-layer trim-preview mode, 6 s load-timeout → `RouteThumb` fallback, dark-mode invert filter).
11. `src/app/activities/[id]/page.tsx` + `src/components/ActivityPhotoCarousel.tsx`.
12. rewire `src/components/Currently.tsx` and `src/components/ActivityCalendar.tsx` exactly as specified in ui/ux (keep these diffs in their own commit for easy review/revert).

**phase E — import [after step 3 + neon migrated; P with C/D]**

13. `scripts/import-strava-archive.ts` (run: `npx tsx --env-file=.env.local scripts/import-strava-archive.ts --dir ~/Downloads/strava-archive [--dry-run] [--limit N] [--tz America/Los_Angeles] [--no-trim]`): parse `activities.csv` with `csv-parse` (quoted fields); for each row resolve `Filename` (`activities/12345.fit.gz` → gunzip via fflate; also handles `.gpx`/`.tcx`(.gz)); prefer fit-derived stats/timestamps (fit `localTimestamp` wins for local date/time; `--tz` fallback), csv fallback for file-less manual rows (`source='manual'`, distance km→m, "Relative Effort"→`suffer_score`); apply default 200 m privacy trim to gps activities unless `--no-trim`; `put()` original to the content-addressed blob path; insert `on conflict (dedupe_key) do nothing`; log per-row outcome + final summary `{inserted, skipped(duplicate), csvOnly, failed}` with failures listed. re-runnable safely by construction; discrepancies between fit and csv distance > 5% get a warn line for manual review.

**rollout order (non-destructive):** deploy phases A+B+C+D-except-12 first — the public site is byte-identical since nothing consumes the new endpoints yet. run the import script against production neon; spot-check `/api/activities` and a few `/activities/[id]` pages. only then merge step 12 (the two-widget rewire). if anything is wrong, reverting one small commit restores the old (empty-but-stable) strava wiring.

## dependencies

npm (runtime):

- `next-auth@^5` (auth.js v5) — google sign-in + session jwt for admin gating; same sign-in reused for public users in ws5.
- `@neondatabase/serverless` — http driver for neon; no tcp pooling problems on vercel functions; also used by the local script.
- `drizzle-orm` — typed schema/queries mapping rows onto `CalendarActivity`; neon-http adapter.
- `@vercel/blob` — server `put`/`list` + `@vercel/blob/client` `upload`/`handleUpload` for the client-upload path that bypasses the 4.5 MB body cap.
- `@garmin/fitsdk` — official garmin fit decoder (locked ws1 decision; repo name garmin-fit-sdk).
- `fflate` — tiny pure-js unzip/gunzip for garmin "export original" zips and strava-archive `.fit.gz`; shared by parse route and import script.
- `maplibre-gl` — detail-page route map on openfreemap vector tiles (locked ws1 decision); dynamically imported so it never enters the public bundle outside `/activities/[id]` and `/admin/upload`.
- `@tmcw/togeojson` + `@xmldom/xmldom` — gpx/tcx → track points in node (togeojson needs a dom parser); only loaded inside the parse path.
- `heic2any` — browser wasm heic→jpeg decode, lazily `import()`ed only when a heic file is actually picked (keeps admin bundle small; canvas handles the downscale).

npm (dev): `drizzle-kit` (migration generation/apply), `tsx` (run the import script with ts + `--env-file`), `csv-parse` (robust quoted-csv parsing for `activities.csv`).

env vars to add (vercel + `.env.local`): `DATABASE_URL`, `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `ADMIN_EMAILS=andrew06zhou@gmail.com`, `BLOB_READ_WRITE_TOKEN` (auto-added when the blob store is linked). phase 2 (documented, unset for now): `INTERVALS_ICU_ATHLETE_ID`, `INTERVALS_ICU_API_KEY`. existing and unchanged: `STRAVA_API_ENABLED` (stays false/unset), `ADMIN_API_SECRET` (kept as script/curl fallback inside `isAdminRequest`), `KV_REST_API_*`.

## failure modes & observability

log sources (one json line each via `src/lib/log.ts`): `api:activities`, `api:activities/latest`, `api:activities/[id]`, `admin:parse`, `admin:publish`, `admin:edit`, `admin:blob`, `admin:storage`, `auth`, `import`. every publish logs `{id, dedupeKey, source, distanceM, trimStartM, trimEndM}`; every parse logs duration + file type + byte size; storage audit logs totals.

| failure | user sees | logged |
|---|---|---|
| neon down, public reads | calendar/currently render last-good data via `getCachedData` stale path (`stale: true`), up to 7 days; with cold redis: calendar renders empty month grid, currently omits the workout sentence — existing quiet-degrade behavior, no crash (error boundaries from ws0 back-stop) | `error api:activities db fetch failed` + `warn cache:activities_list serving stale` |
| neon down, publish | preview intact; gray italic `publish failed — database unavailable, retry in a minute`; nothing lost (original already in blob, draft state client-side) | `error admin:publish` |
| redis down | everything works, one direct db query per request (`getCachedData` already falls through on redis errors) | `error cache:* redis read failed` |
| blob upload fails (photo or track) | per-item gray italic `upload failed — retry`; publish blocked only for the track, photos can be removed and retried | `error admin:blob` |
| blob fetch fails at publish (original unreachable) | `publish failed — could not re-read original file` | `error admin:publish blob fetch` |
| blob store > 1 GB (30-day lockout cliff) | prevented, not handled: dashboard shows usage always; warn at 700 MB, error-log at 900 MB; r2 migration is the documented escape hatch | `warn/error admin:storage` |
| openfreemap tiles down / webgl absent | detail page and trim preview silently swap to the svg `RouteThumb` after 6 s or on construction error — route still visible, trim still usable | `warn routemap tiles failed, svg fallback` (client console only) |
| corrupt / truncated fit, zip with ≠1 track file, unsupported extension | 422/400 with a specific lowercase message rendered in the error phase; original bytes already persisted to blob for post-mortem | `warn admin:parse decode failed` with sdk error strings |
| duplicate upload | preview banner `already published — view activity →`, publish disabled; race-condition duplicate at publish → 409 handled as the same message | `info admin:publish duplicate` |
| heic decode fails on-device | that photo shows `couldn't convert this photo` and is skipped; rest of the flow unaffected | client console |
| gpx > 4 MB | automatic fallback to blob client upload, invisible to the user; > 30 MB rejected with message | `info admin:parse blob-path` |
| google oauth outage | `/admin` sign-in fails visibly (next-auth error page → styled message on the gate card); public site completely unaffected (auth is imported nowhere on public pages) | `error auth` |
| import script: missing file for csv row / parse failure | row skipped and listed in the end-of-run failure summary; exit code 1 if any failures; db never partially overwritten (insert-only, conflict-ignore) | stdout lines + summary |

## testing plan

vitest (node env), following the existing patterns in `src/lib/__tests__/` and `src/app/api/__tests__/` (mocked `@upstash/redis`, route handlers invoked directly):

- `src/lib/__tests__/polyline.test.ts` — encode/decode round-trip, precision-5 fidelity, empty/single-point inputs, known google reference vector.
- `src/lib/__tests__/geo.test.ts` — haversine sanity; rdp: output ≤ maxPoints, endpoints preserved, straight line collapses to 2 points; trim on a synthetic 10 km track: kept distance/elapsed/moving/elevation recompute exactly, zero-trim returns session totals untouched, over-trim clamps; moving-time gap rule (>10 s deltas excluded).
- `src/lib/__tests__/fit.test.ts` — decode a small real fixture fit (checked in under `__tests__/fixtures/`, ~50 KB; the garmin sdk repo ships sample fits) → assert normalized fields, semicircle conversion, local-offset derivation, sport mapping table (each row), zip-with-one-fit and `.fit.gz` unwrapping via fflate, zip-with-two-fits rejection.
- `src/lib/__tests__/activities.test.ts` — `rowToCalendarActivity` covers every `CalendarActivity` field; `dedupeKey` stable across trim changes and re-parses; `suggestedName` buckets (morning/afternoon/evening × sport).
- `src/app/api/__tests__/activities-route.test.ts` — mocked db: list shape `{activities, lastFetchedAt}` matches the old `/api/strava/activities` contract; latest payload **passes `isStravaActivity` from `src/lib/validate.ts`** (the regression that matters); db-throw → stale-from-redis path; cold-cache db-throw → 500 with empty shape.
- `src/app/api/__tests__/admin-activities-route.test.ts` — publish: 401 without session/secret, 201 happy path invalidates both redis keys, 409 on dedupe conflict, server recompute ignores client-supplied stats; PATCH trim change recomputes polyline; DELETE defaults to soft-hide.
- `src/lib/__tests__/admin-auth.test.ts` — session-admin passes, non-allowlisted session fails, secret-header fallback still passes, origin mismatch rejected on mutations.
- `src/lib/__tests__/import-csv.test.ts` — csv row parsing (quoted commas, km→m, relative effort), file-less manual rows, idempotency (second run inserts zero with a mocked conflict-returning db).

not unit-tested (manual verification during rollout, via the two-stage deploy): maplibre rendering, heic conversion on a real phone, pwa install, actual blob uploads.

## risks & open questions

1. **default privacy trim distance** — recommend **200 m from each end** (strava's historical privacy-radius convention; obscures an address without gutting short runs; sliders make anything else one drag away). owner confirms the number.
2. **apply the default trim during bulk import?** every historical activity starting at home would otherwise publish untrimmed. recommend **yes** (script default, `--no-trim` to opt out), accepting slightly understated historical distances.
3. **run cadence semantics** — devices report one-leg cadence for runs; strava displayed doubled spm in some views. recommend **store raw device values** (matches what the old redis data held) and leave display doubling as a future formatting decision.
4. **neon region** — recommend **aws us-east-1 (matching vercel's default iad1 function region)** to keep query latency ~1 ms-digit; confirm the vercel project's function region before creating the neon project.
5. **edit page in v1** — recommend **yes** (it's a thin reuse of the preview component and is the only way to fix a bad trim without sql); cut it first if the workstream runs long.
6. **timezone fallback for archive rows without fit local timestamps** — recommend `--tz America/Los_Angeles` default; activities recorded while traveling will show the wrong local hour, which the edit page can fix case-by-case. acceptable?
7. **manifest icons** — need actual 192/512 pngs; recommend rendering `public/images/logo.svg` on a `#101010` tile during implementation rather than designing anything new.
8. **full stream storage (hr/power/elevation time series) for future charts** — recommend **defer**: originals in blob make streams re-derivable at any time; adding a `streams_blob_url` column later is a one-line migration. confirm charts aren't wanted in ws2.
9. **`/activities` index page** — not in scope (calendar is the browse surface; detail pages are linked from it). confirm skipping, since the back link on detail pages points home accordingly.
10. **old `strava_activities` redis key** — now an empty array; recommend leaving it untouched (it documents the incident and costs nothing) rather than deleting, until ws3 cleanup.
