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

> constraint (2026-07-06): **no styling / inline-css refactors in this phase.**
> existing inline styles are intentional render-fixes; any visual consolidation
> happens later, one change at a time with user verification. WS0 ui changes are
> limited to functional element removal and conditional rendering.

- [ ] request strava archive export (user action — unblocks WS2 seed data)
- [ ] `STRAVA_API_ENABLED` env flag — strava code stays dormant (no calls to the
      dead api, no 403 log spam) but is preserved in case strava+ ever happens
- [ ] observability pattern for every dependency/error path: structured server-side
      logging (source-tagged), user-side degraded states instead of crashes or
      blank sections — applies to all current and future integrations
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
decisions locked 2026-07-06 (user confirmation), except blob storage which is
pending the storage research (git-vs-blob comparison with verified limits):
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
      polyline, trim metadata, photo refs), `activity_photos`
- [ ] route privacy controls in upload flow: start-trim and end-trim **sliders**
      (arbitrary distance from either end) plus a **one-click privacy trim** button
      applying a default trim; trimming affects the published route/stats, original
      .fit retained
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
      number/title/difficulty via leetcode's public graphql (unofficial — reliability
      research 2026-07-06; hard error gating: timeout, non-json/schema-drift
      detection, clear user-facing failure message, manual-entry fallback always
      available)
- [ ] unified multi-month calendar: every event type (activity, leetcode, commit,
      blog, photos, library) with per-type icons / blurred thumbnails; month →
      day → entry drill-down; doubles as the browse ui. generalizes
      ActivityCalendar's existing view-state machine.

### WS4 — design system consolidation — items 6, 12 (audit half)
full component inventory completed 2026-07-06 (see §5).

> constraint: existing-component visual refactors happen **one at a time, each
> user-verified** — inline styles are intentional render-fixes, not cleanup fodder.
> new features are built on shared primitives from day one; consolidating old
> components onto them is a slow, verified migration, not a batch rewrite.

extract shared primitives (for new code first):
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

### WS5 — engagement (comments, likes, claps, views) — item 9
scope updated 2026-07-06 per user:
- [ ] comments: guests and signed-in (google) both auto-publish through **simple
      filtering** (word list, link limit, upstash rate limit, honeypot). no llm
      screening for now. no notifications for now.
- [ ] likes: signed-in users only; guests tapping like get a sign-in prompt
- [ ] claps: second button, pressable unlimited times, signed-in or not
- [ ] view counter per blog post / photoset / activity
- [ ] postgres tables: `comments`, `likes`, `claps`, `views` (or counter rows)
- [ ] admin: comment delete/hide in WS3 dashboard (filtering is automatic, but
      removal must be possible after the fact)

### WS6 — content model evolution — items 11, 12 (coursework half), 4 (pin)
- [ ] "photo essay" block format (photos section only): ordered blocks of
      image | gallery | text; image blocks get caption below the frame (box shape
      never changes with text length) and a collapsible right sidebar: exif
      (aperture, shutter, iso, camera, dimensions) + coordinates + minimap pin.
      serves pure galleries (label-only), road-trip essays (photos + paragraphs),
      and single showcase photos.
- [ ] blog and photos stay **entirely separate** (decided 2026-07-06) — the block
      format and sidebar layout are unique to photos; blog remains the mdx pipeline
- [ ] coursework detailed version per the new sections.yaml blurb: **expandable
      rows in the same list template as other tabs**, with per-class experience,
      review, notes/cheatsheet links; add a **sort control (a–z / by semester) as an
      optional element of the shared list template** so other tabs can opt in later
- [ ] homepage tab template unification on WS4 primitives (one-at-a-time, verified)

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

## 6. decisions (locked 2026-07-06 unless noted)

| decision | outcome |
|---|---|
| data layer | **hybrid**: git (authored) + postgres/neon (dynamic) + vercel blob (binary) + redis (cache only) |
| blob storage | **vercel blob, decided by research** ([details](research/storage-blob-vs-git.md)): vercel's 4.5mb request-body cap hard-blocks phone photos through api routes, commit-per-upload costs minutes of rebuild vs instant blob urls, and photos-in-git bloats the public repo ~2.6gb/yr. mandatory: client-side heic→jpeg/webp downscale (~2000px) + store-size audit before the 1gb hobby cliff. existing public/photos stays in git. r2 = documented fallback |
| auth | auth.js + google, admin email allowlist |
| publish latency | ~1–2 min rebuild accepted for authored content |
| fit source | **researched** ([details](research/garmin-fit-paths.md)): mvp = connect.garmin.com in phone browser → "export original" (zip w/ original .fit) → /admin upload (must accept + unzip .zip). phase 2 automation = intervals.icu (free official garmin partner, api serves original fit) with a "pull latest" button. bulk = strava archive, garmin gdpr export as gap-filler. unofficial garmin scraping rejected as primary (jan 2026 auth crackdown, garth deprecated) |
| route privacy | **sliders** for arbitrary start/end trim + **one-click privacy trim** button |
| maps | svg polyline cards + maplibre/openfreemap detail pages |
| old strava code | kept dormant behind `STRAVA_API_ENABLED` (in case of strava+) |
| editor | mdxeditor, restyled to theme |
| leetcode url parse | **researched, viable** ([details](research/leetcode-graphql.md)): endpoint verified working unauthenticated (live-tested 2026-07-06), query shape stable since ~2018, vercel egress not blocked. direct ~25-line fetch (no wrapper), use questionFrontendId, gate on json content-type + null question + difficulty enum, 8s timeout, redis-cache successes, save path never depends on the lookup |
| engagement | simple filters for guests AND signed-in; likes (signed-in, guests prompted); unlimited claps (anyone); view counters; no llm; no notifications |
| blog/photos | **entirely separate** — photo essay format unique to photos |
| coursework | expandable rows in shared list template + optional sort element (a–z / semester) |
| css refactors | **never in bulk** — one at a time with user visual verification |
| testing | vitest + github actions ci |
| ws0 | **shipped 2026-07-06** (commits ac4f432…cdd7903): spotify crash fixed, stale-cache serving, timeouts, error boundaries, admin-gated mutations, non-destructive refresh, strava dormancy flag, blog button removed, optional blurbs, pinned posts, vitest + ci. remaining user actions: request strava archive; add ADMIN_API_SECRET (+ STRAVA_API_ENABLED=false optional) to vercel env |
