# site v4 master plan

planning document for replacing the strava integration with a self-hosted activity
platform, adding an admin dashboard, and consolidating the site's design system.
nothing in here is implemented yet — each workstream below gets a detailed design
after the open questions are answered.

status legend: `[ ]` pending · `[~]` in progress · `[x]` done

---

## 1. current architecture (as of 2026-07-06)

**stack**: next.js 16 (app router, turbopack) · react 19 · tailwind 4 · mdx via
`@next/mdx` · typescript. deployed on vercel from the public github repo
(`andrewyzhou/personal-site`), domain `andrewzhou.org` (redirects to `www.`).

**data sources**
| source | consumed by | caching |
|---|---|---|
| content/ mdx + yaml (git) | all pages, statically rendered | build-time |
| spotify api (oauth refresh token) | `/api/spotify` → Currently | redis, 1 min ttl |
| strava api (**dead — 403 app inactive**) | `/api/strava`, `/api/strava/activities` → Currently, ActivityCalendar | redis, 5 min ttl + persistent `strava_activities` key |
| literal.club graphql | `/api/literal` → Currently | redis, 1 hr ttl |
| github graphql (contributions) + rest (commits of `andrewyzhou/leetcode`) | `/api/github`, `/api/github/leetcode` → GitHubActivity, ActivityCalendar | next fetch revalidate 5 min / redis persistent |
| upstash redis (`KV_REST_API_*`) | cache + persistent stores + counters (`api_calls`, `page_views`) | — |

**cache pattern** (`src/lib/cache.ts`): `getCachedData(key, fetchFn)` — fresh-if-young,
refetch-if-stale, 24h redis safety ttl. only caches non-null. falls back to direct
fetch if redis is down. no stale-serving on upstream failure.

## 2. incidents found during this audit

### 2.1 strava history wiped (data loss, already happened)
the persistent `strava_activities` redis key now contains an **empty array**.
cause: `POST /api/strava/refresh` and `POST /api/strava/activities/full-refresh`
delete the key, then call `getAllActivities()` which swallows errors and returns
`[]` — with the strava api dead (403), any invocation (e.g. the refresh button in
ActivityCalendar) permanently overwrites history with nothing.

recovery path: strava account archive export (settings → my account → download or
transfer your account) ships original .fit files for every activity. these become
the seed data for the replacement pipeline. **archive should be requested asap.**

lesson baked into the new design: redis is cache only, never system-of-record;
destructive endpoints require auth; imports must be idempotent and never
delete-before-write.

### 2.2 Currently.tsx crash (verified root cause, not yet fixed)
`/api/spotify/route.ts` returns `NextResponse.json({ ...data, fetchedAt, previousFetchedAt })`
without a null guard. when the spotify fetch fails, `data` is `null` and `{...null}`
spreads to `{}` — the client receives a truthy `{fetchedAt, previousFetchedAt}` object
with no `title`/`artist`, passes the `if (data)` check in `Currently.tsx`, and
`spotify.title.toLowerCase()` throws. `/api/strava` and `/api/literal` both have the
guard; spotify is missing it. intermittent because it only fires when spotify's
upstream call fails. fix + regression test in workstream 0. there is no
`error.tsx`/`global-error.tsx` anywhere, so this one widget crash blanks the whole
home page — error boundaries also land in workstream 0.

### 2.3 unauthenticated mutation endpoints
`POST /api/cache/clear` (deletes arbitrary redis key), `POST /api/strava/refresh`,
`POST /api/strava/activities(/full-refresh)`, `POST /api/github/leetcode`. all
callable by anyone. gated or removed in workstream 0; long-term all mutations live
behind admin auth (workstream 2).

---

## 3. workstreams

maps the original items 1–12 into ordered, dependency-aware groups.

### WS0 — stabilize (no architecture decisions needed) — items 1, 3, 4, 10
- [ ] request strava archive export (user action — unblocks WS2 seed data)
- [ ] fix spotify route null guard; normalize all `/api/*` responses to a common
      `{data | null}` envelope; add missing fetch timeouts (spotify, strava, github
      have none; literal already has 2s)
- [ ] serve-stale-on-failure in `getCachedData`: keep last-good value, return it
      (with a `stale` flag) when the upstream fetch throws, instead of null
- [ ] error boundaries: `app/error.tsx`, `app/global-error.tsx`, and a per-widget
      boundary around Currently / ActivityCalendar / GitHubActivity so a widget
      failure renders a quiet fallback instead of blanking the page
- [ ] client-side shape validation before `setState` in Currently (the crash class)
- [ ] gate or remove the unauthenticated mutation endpoints (temporary shared-secret
      header until real admin auth exists)
- [ ] test harness: vitest + tests for cache fallback, api null paths,
      `buildPlainTextAndLinks` with each data source missing; github actions ci
- [ ] item 4: remove blog link from SocialLinks (next to resume); make section
      blurbs optional (skip rendering when empty); support `pinned: true` blog
      frontmatter for the future "first entry" pin on the blog tab
- [ ] item 10: roadmap tracker in README (seeded, links here)

### WS1 — architecture decisions (blocks everything below) — items 2, 3, 8 (storage part)
decide and document:
- **data layer (recommended: hybrid)** — git stays system-of-record for authored
  content (blog/library/photo-essays/bio/sections/coursework), edited from admin via
  github api commits → vercel auto-deploy (keeps the github history + activity graph
  you want, item 8); **postgres** (neon free tier) for instant-publish dynamic data:
  activities, comments, photo/exif metadata; **blob storage** (cloudflare r2 or
  vercel blob) for .fit files + photos; **redis demoted to cache only**.
  alternative considered: all-postgres with async git mirror (instant publish for
  everything, more moving parts).
- **auth** — auth.js (nextauth v5) with google provider; admin = email allowlist;
  same sign-in reused for public commenters (item 9). answers "google auth for admin
  permissions?" → yes.
- **maps (recommended: two-tier)** — feed/cards render the route as a minimal inline
  svg polyline (zero external deps, crash-proof, on-theme); detail pages use maplibre
  gl + openfreemap vector tiles (free, no api key) with graceful fallback to the svg.
  same minimap primitive reused for photo locations (item 11).
- **fit parsing** — `garmin-fit-sdk` (official) server-side on upload; summary row →
  postgres; downsampled gps polyline + full streams (hr/cadence/power/elev) → blob
  or jsonb; original .fit retained in blob. bulk seed import from the strava archive
  runs as a local script, not through serverless.
- **markdown editor** — mdxeditor (react, markdown wysiwyg with live rendering),
  restyled to the site's monochrome theme.

### WS2 — activity platform, `replace-strava` branch — items 2, 5, 7
- [ ] postgres schema: `activities` (summary stats mirroring `CalendarActivity`, plus
      polyline, privacy-zone-applied flag, photo refs), `activity_photos`
- [ ] `/admin` shell: google auth, mobile-friendly (pwa manifest), minimal theme
- [ ] .fit upload (drag/drop + file picker) → parse → preview → publish; idempotent
      by activity start-time+hash; never destructive
- [ ] photo upload alongside activity (item 5): blob storage, sharp resize pipeline,
      exif extraction, heic→jpeg
- [ ] bulk import script for the strava archive (seeds full history incl. old
      redis-era stats)
- [ ] swap Currently + ActivityCalendar data source to `/api/activities` (new, reads
      postgres); strava api code stays dormant behind an env flag in case the paid
      api is ever revisited
- [ ] activity detail page (item 7): `/activities/[id]` — full-screen route map,
      stats (hr, pace, elevation…), photo carousel (shared primitive from WS4)
- [ ] feed cards: svg route thumbnail + photo carousel, mirroring the old strava feed
- [ ] leetcode detail pages: skip for now (agreed low value)

### WS3 — admin cms — item 8
- [ ] content crud for everything in `content/` via github api commits (create/edit
      blog, library, photo essays, bio, sections, coursework) with mdxeditor +
      frontmatter forms (no more hand-editing yaml against reference files)
- [ ] "+" new-entry flows per type; browse/sort/edit existing entries
- [ ] leetcode entry: form (number/title/difficulty/code) → commits solution file to
      `andrewyzhou/leetcode` with the `"N. Title (Difficulty)"` message the existing
      pipeline already parses (activity graph preserved); url-paste mode fills
      number/title/difficulty via leetcode's public graphql (unofficial; manual
      fallback)
- [ ] unified multi-month calendar: every event type (activity, leetcode, commit,
      blog, photos, library) with per-type icons / blurred thumbnails; month →
      day → entry drill-down; doubles as the browse ui. generalizes
      ActivityCalendar's existing view-state machine.

### WS4 — design system consolidation — items 6, 12 (audit half)
full component inventory completed 2026-07-06 (see §5). extract shared primitives:
- [ ] `formatDate` util (currently 5 duplicate implementations)
- [ ] `<ContentCard>` (BlogIndex PostRow ≈ LibraryIndex EntryRow ≈ experience rows)
- [ ] `<PageHeader>` (identical in blog/library/photos index pages)
- [ ] `<DetailHeader>` + `<AdjacentNav>` (blog/library detail pages)
- [ ] `<FilterChips>` (duplicated blog/library)
- [ ] `<Carousel>` (new: activity photos, photoset viewer, blog Gallery)
- [ ] `<RouteMap>` / `<MiniMap>` (svg card + maplibre detail + photo pin)
- [ ] `<AsyncWidget>` (loading/error/stale wrapper for all api-backed widgets)
- [ ] consolidate breakpoints + move inline `style={{}}` spacing into tokens
timed before/alongside WS2 ui work so new features are built on the primitives, not
added to the duplication.

### WS5 — comments — item 9
- [ ] postgres `comments` table (target type+slug, author, body, status)
- [ ] guest comments → approval queue; signed-in (google) → auto-publish through
      basic filters (word list, link limit, upstash rate limit, honeypot)
- [ ] optional llm screen later (claude haiku ~$0.001/comment; "free local llm"
      isn't runnable on vercel serverless)
- [ ] admin moderation queue in WS3 dashboard

### WS6 — content model evolution — items 11, 12 (coursework half), 4 (pin)
- [ ] "photo essay" block format: ordered blocks of image | gallery | text; image
      blocks get caption below the frame (box shape never changes with text length)
      and a collapsible right sidebar: exif (aperture, shutter, iso, camera,
      dimensions) + coordinates + minimap pin. serves pure galleries (label-only),
      road-trip essays (photos + paragraphs), and single showcase photos.
- [ ] blog and photos both render through the block engine; keep separate tabs
      (blog = text-first, photos = image-first) unless merge is chosen in Q17
- [ ] coursework detailed version per the new sections.yaml blurb: per-class
      experience, review, notes/cheatsheet links
- [ ] homepage tab template unification on WS4 primitives

---

## 4. execution order & parallelization

```
WS0 (now, no decisions) ──────────────┐
WS1 decisions (user answers Qs) ──────┼──> WS2 (replace-strava) ──> WS3 ──> WS5
                                      └──> WS4 primitives ─────────^   └──> WS6
```

- WS0 tasks are file-disjoint and safe to run as parallel implementation agents
  (worktrees): (a) resilience+tests, (b) item-4 ui fixes, (c) readme tracker.
- after WS1 answers, four **plan agents** can run in parallel (read-only, no
  conflicts): activity platform · admin cms · comments · design system/content
  formats. outputs get reviewed and turned into implementation prompts.
- WS2 implementation splits cleanly after the schema + primitives are pinned:
  backend (schema/upload/parse/import) ∥ frontend (feed/detail/calendar rewire).
- WS3/WS5/WS6 are sequential after their dependencies; internal splits decided in
  their detailed plans.

## 5. component inventory (item 12) — key findings

full inventory captured 2026-07-06 during audit. highlights:
- **duplication**: 5× `formatDate`; PostRow/EntryRow ~85% identical; 3× identical
  index-page headers; 2× filter-chip logic; blog/library detail pages near-identical
  structure; multiple ad-hoc breakpoint systems (768px defined 3 ways).
- **link primitives**: `.link-highlight` / `-active` (globals.css) cover text links,
  tabs, chips; icon links use a different opacity pattern; internal/external
  detection implemented two different ways (Currently vs mdxComponents).
- **tokens**: solid semantic css-variable theme (`--theme-*`, contrib scale,
  scrollbar) with dark/light via html class; undermined by widespread inline
  `style={{}}` margins/letter-spacing.
- **data widgets**: Currently (4 parallel fetches, custom event to ActivityCalendar),
  ActivityCalendar (strava/leetcode modes, view-state machine: calendar → selector →
  detail — the template for the unified calendar), GitHubActivity (responsive
  week-count graph).

## 6. decisions pending (answers drive WS1+ detailed plans)

see the numbered question list in the planning conversation / below. defaults are
the recommendations in §3.

| # | decision | recommendation |
|---|---|---|
| Q1 | data layer | hybrid: git (authored) + postgres (dynamic) + blob (binary) + redis (cache) |
| Q2 | postgres provider | neon free tier |
| Q3 | blob provider | cloudflare r2 (10gb free) — vercel blob if no new account wanted |
| Q4 | auth | auth.js + google, admin email allowlist |
| Q5 | publish latency | accept ~1–2 min rebuild for authored content |
| Q6 | fit source device | **user input needed** (garmin / apple watch+healthfit / other) |
| Q7 | strava archive | request immediately |
| Q8 | route privacy | privacy zone on by default |
| Q9 | maps | svg cards + maplibre/openfreemap detail |
| Q10 | old strava code | keep dormant behind env flag |
| Q11 | editor | mdxeditor, restyled |
| Q12 | admin pwa manifest | yes |
| Q13 | leetcode via github commits + graphql url parse | yes |
| Q14 | moderation | queue guests, filter+publish signed-in, llm later |
| Q15 | comment notifications | **user input needed** |
| Q16 | comment threading | flat v1 |
| Q17 | blog/photos merge | shared block engine, separate tabs |
| Q18 | exif gps precision | round to ~1km publicly |
| Q19 | coursework format | **user input needed** |
| Q20 | blog tab pre-first-post | plain list, no blurb |
| Q21 | vitest + gh actions ci | yes |
| Q22 | ws0 go-ahead | awaiting confirmation |
