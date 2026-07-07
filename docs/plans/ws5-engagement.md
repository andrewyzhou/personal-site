# ws5 — public engagement: comments, likes, claps, view counters

design doc for PLAN.md workstream 5 (item 9, scope locked 2026-07-06). implementation-ready; all decisions below are made unless flagged in §risks.

## overview (goals, non-goals)

**goals**

- add four engagement primitives to three target types — blog posts (`/blog/[slug]`), photosets (`/photos/[slug]`), activities (`/activities/[id]`, ws2 page):
  - **comments**: flat (no threading), auto-publish for guests and google-signed-in users, gated by simple deterministic filters (blocklist, link limit, length caps, honeypot, rate limits, dedupe). no llm, no approval queue, no notifications.
  - **likes**: signed-in only, one per user per target, toggleable; guests get an inline sign-in prompt (no modal library).
  - **claps**: unlimited presses by anyone, batched client-side, capped per ip-hash per target per day.
  - **views**: per-target counter, counted once per browser session via sessionStorage flag, displayed subtly.
- neon postgres is system-of-record for all engagement data plus auth.js user/account tables. upstash redis is used only for rate-limit state and view dedupe (ephemeral abuse control — losing it resets caps, never loses data; consistent with the "redis = cache only" decision in PLAN.md §6).
- privacy: no raw ips stored anywhere (salted sha256 only); minimal google profile data (name, email, avatar url); account deletion by email + script.
- resilience: every engagement surface degrades quietly. neon down → engagement ui hides, static content untouched. redis down → rate limits fail open with logged warnings, postgres-enforced caps still hold.
- admin moderation: recent-comments list with hide/unhide/delete, session-auth'd, mounted in the `/admin` shell (ws2/ws3); the api endpoints are the "ws3 dashboard hook".
- replace the ws0 `ADMIN_API_SECRET` stopgap **for new endpoints only** with auth.js session checks (email allowlist). existing stopgap-gated routes (`src/lib/admin-auth.ts` consumers) are untouched — ws3 migrates those.

**non-goals**

- no threading, no reactions-per-comment, no edit-own-comment, no notifications, no llm moderation, no db-editable blocklist (env/file-based v1), no self-serve account deletion ui, no engagement on library entries or the home page, no comment pagination ui beyond a hard cap, no styling refactors of any existing component (hard constraint), no changes to dormant strava code.

**assumed landed before ws5 starts** (per PLAN.md §4 execution order ws2 → ws3 → ws5): neon `DATABASE_URL` provisioned, `activities` table exists, `/admin` shell with google auth exists. if ws5 is pulled earlier, everything here still works except activity targets and the admin page mount point (see §risks q9).

---

## data model

**client choice**: `drizzle-orm` + `@neondatabase/serverless` (neon-http driver). rationale: ws2 needs a postgres client anyway and PLAN.md doesn't lock one; drizzle is the only option with a first-party auth.js adapter (`@auth/drizzle-adapter`), gives typed queries consistent with the repo's strict typescript, and drizzle-kit generates plain-sql migrations (auditable in git, never destructive). the neon-http driver is one https request per query — no connection pooling issues on vercel serverless. this doc's schema file becomes the shared home for ws2's `activities` tables too.

files:

- `src/lib/db/schema.ts` — drizzle schema (auth + engagement tables; ws2 adds activities here)
- `src/lib/db/client.ts` — singleton: `drizzle(neon(process.env.DATABASE_URL!))`, exported as `db`; throws a descriptive error at first query, not import time, when `DATABASE_URL` is unset
- `drizzle.config.ts` — drizzle-kit config pointing at `src/lib/db/schema.ts`, out dir `drizzle/`
- `drizzle/` — generated sql migrations, committed
- package.json scripts: `"db:generate": "drizzle-kit generate"`, `"db:migrate": "drizzle-kit migrate"`

canonical ddl (what drizzle-kit must generate; types are load-bearing):

```sql
-- ============ auth.js (standard @auth/drizzle-adapter pg schema) ============
create table users (
  id             text primary key,            -- crypto.randomUUID() via drizzle $defaultFn
  name           text,                        -- google display name (shown on comments)
  email          text not null unique,        -- needed for admin allowlist + deletion requests
  "emailVerified" timestamptz,
  image          text                         -- google avatar url (shown at 20px; see risks q7)
);

create table accounts (
  "userId"            text not null references users(id) on delete cascade,
  type                text not null,
  provider            text not null,
  "providerAccountId" text not null,
  refresh_token       text,
  access_token        text,
  expires_at          integer,
  token_type          text,
  scope               text,
  id_token            text,
  session_state       text,
  primary key (provider, "providerAccountId")
);

-- sessions + verification_tokens: created for adapter compatibility but UNUSED —
-- session strategy is jwt (see api surface / auth). keeping them costs nothing and
-- avoids adapter code-path surprises; do not read from them.
create table sessions (
  "sessionToken" text primary key,
  "userId"       text not null references users(id) on delete cascade,
  expires        timestamptz not null
);
create table verification_tokens (
  identifier text not null,
  token      text not null,
  expires    timestamptz not null,
  primary key (identifier, token)
);

-- ============ engagement ============
-- target_id holds the git slug for blog/photos (e.g. 'hello-world') and the
-- postgres activity id (stringified) for activities. deliberately NO foreign key:
-- blog/photos live in git, not the db. existence is validated in the api layer.

create table comments (
  id          uuid primary key default gen_random_uuid(),
  target_type text not null check (target_type in ('blog','photos','activity')),
  target_id   text not null check (char_length(target_id) <= 120),
  user_id     text references users(id) on delete cascade,  -- null = guest
  guest_name  text check (char_length(guest_name) <= 40),   -- null for signed-in or anonymous guests
  body        text not null check (char_length(body) between 2 and 2000),
  body_hash   text not null,          -- sha256 hex of normalized body (dedupe)
  ip_hash     text not null,          -- sha256(ip + IP_HASH_SALT) hex — never the raw ip
  status      text not null default 'published' check (status in ('published','hidden')),
  created_at  timestamptz not null default now()
);
create index comments_target_idx  on comments (target_type, target_id, status, created_at);
create index comments_recent_idx  on comments (created_at desc);            -- admin list
create index comments_dedupe_idx  on comments (target_type, target_id, body_hash, created_at desc);

create table likes (
  user_id     text not null references users(id) on delete cascade,
  target_type text not null check (target_type in ('blog','photos','activity')),
  target_id   text not null,
  created_at  timestamptz not null default now(),
  primary key (user_id, target_type, target_id)
);
create index likes_target_idx on likes (target_type, target_id);

-- claps: aggregate total + per-ip daily ledger. the ledger IS the abuse
-- enforcement (postgres, not redis, so caps survive a redis outage).
create table clap_totals (
  target_type text not null,
  target_id   text not null,
  count       integer not null default 0 check (count >= 0),
  primary key (target_type, target_id)
);
create table clap_daily (
  ip_hash     text not null,
  target_type text not null,
  target_id   text not null,
  day         date not null,
  count       integer not null default 0,
  primary key (ip_hash, target_type, target_id, day)
);
-- rows older than yesterday are garbage: the claps route deletes them
-- opportunistically (~1% of writes run `delete from clap_daily where day < current_date - 1`).

create table view_counts (
  target_type text not null,
  target_id   text not null,
  count       bigint not null default 0,
  primary key (target_type, target_id)
);
```

**numbers (recommended, tunable constants in `src/lib/engagement/constants.ts`)**

| knob | value |
|---|---|
| comment body length | 2–2000 chars (trimmed) |
| guest display name | **optional**, ≤ 40 chars, renders as `anon` when empty |
| max links per comment | **1** (`https?://` or `www.` matches, case-insensitive) |
| dedupe window | same normalized-body hash + target within **10 min** → 409 |
| clap daily cap | **60 per ip-hash per target per day** (medium caps at 50/user; 60 keeps it fun, bounds inflation at ~60/day/ip) |
| clap batch max | 20 per request |
| comments returned per target | first 200, ascending `created_at` (oldest first — conversation order); `cursor` param reserved, not implemented v1 |

**body normalization for `body_hash`**: lowercase → collapse all whitespace runs to single space → trim → sha256 hex. catches trivial repost spam without fuzzy matching.

**privacy**: stored google data = `name`, `email`, `image` only (auth.js defaults; no scopes beyond `openid email profile`). raw ip never persisted or logged — only `ip_hash` (and only its first 8 chars in admin ui/logs). account deletion: user emails andrew06zhou@gmail.com; owner runs `scripts/delete-user.ts <email>` (single `delete from users where email = $1` — cascades wipe accounts, sessions, likes, comments). deleting comments rather than anonymizing is the privacy-friendly default.

---

## api surface

**conventions (all new routes)**

- envelope, matching the ws0 normalization: success → `{ "data": <payload> }`; failure → `{ "data": null, "error": { "code": string, "message": string } }`. codes: `invalid_target` `invalid_body` `too_long` `too_many_links` `blocked_content` `duplicate` `rate_limited` `auth_required` `forbidden` `disabled` `unavailable`.
- `export const dynamic = "force-dynamic"` on every route.
- every POST: (1) reject if `ENGAGEMENT_WRITES_DISABLED=true` → 503 `disabled`; (2) same-origin check (`origin` header host must equal request host when origin is present) → 403 `forbidden` — cheap csrf guard since likes ride the session cookie; (3) ip-hash rate limit via `@upstash/ratelimit` (sliding window, prefix per route). redis failure during a limit check → **fail open** + `log.warn("engagement:ratelimit", ...)` (see §failure modes).
- if `IP_HASH_SALT` is unset, all writes return 503 `unavailable` and `log.error` fires — fail closed, mirroring `admin-auth.ts`'s fail-closed pattern, because unhashed handling is not acceptable.
- target validation (`src/lib/engagement/targets.ts`): `blog` → `getPostBySlug(id)` from `src/lib/blog.ts`; `photos` → new `photosetExists(slug)` added to `src/lib/photos.ts` that checks `content/photos/<slug>.yaml` existence **only** (must not call `readPhoto` — that reads `public/photos/` images, which aren't fs-available in vercel functions); `activity` → `select 1 from activities where id = $1` (ws2 table). unknown → 400 `invalid_target`. `next.config.ts` gets `outputFileTracingIncludes: { "/api/engagement": ["./content/**"], "/api/comments": ["./content/**"], ... }` so the content dir is guaranteed present at runtime.
- admin auth: `isAdminSession()` from new `src/lib/auth.ts` — auth.js session email ∈ `ADMIN_EMAILS` (comma-separated, defaults to `andrew06zhou@gmail.com` in code). the ws0 `x-admin-secret` header is **not** accepted on these new routes.

**auth**

`src/lib/auth.ts` — `NextAuth({ adapter: DrizzleAdapter(db, {...tables}), providers: [Google], session: { strategy: "jwt" }, callbacks: { jwt, session } })`. jwt strategy is deliberate: no db read per request, and existing sessions keep validating while neon is down (only new sign-ins fail). the `jwt` callback stamps `token.uid` and `token.isAdmin` (allowlist check at sign-in time); `session` callback copies both onto `session.user`. exports: `handlers`, `auth`, `signIn`, `signOut`, `isAdminSession()`.

| method | path | auth | notes |
|---|---|---|---|
| GET/POST | `/api/auth/[...nextauth]` | — | auth.js handlers re-export |

**engagement read (one round trip per page view)**

`GET /api/engagement?type=blog&id=hello-world` — public, no rate limit (read-only, one query batch).

response 200:

```json
{ "data": {
  "comments": [ { "id": "uuid", "name": "andrew", "avatar": "https://…|null",
                  "body": "…", "createdAt": "2026-07-06T00:00:00Z",
                  "mine": false } ],
  "likes":  { "count": 12, "likedByMe": false },
  "claps":  { "count": 340 },
  "views":  { "count": 1289 },
  "viewer": { "signedIn": true, "name": "andrew", "isAdmin": false }
} }
```

- comments: `status='published'` only, ascending, limit 200. `name` = user `name` → `guest_name` → `"anon"`. `mine` true when `user_id` matches session (used for future self-delete; harmless now).
- executed as one `db.batch([...])` (neon-http pipelines it in a single request).
- failures: 400 `invalid_target`; 503 `unavailable` on db error (client hides the section).

**comments**

`POST /api/comments` — guests + signed-in. body:

```json
{ "targetType": "blog", "targetId": "hello-world",
  "body": "great post", "guestName": "kai", "website": "" }
```

pipeline, in order (`src/lib/engagement/filter.ts` pure functions + route glue):

1. writes-disabled / same-origin / salt checks (above).
2. rate limit: 3/min AND 20/day per ip-hash; if signed in, additionally 5/min per user id. → 429 `rate_limited`.
3. **honeypot**: `website` non-empty → log `log.info("engagement:filter", "honeypot hit")`, return **200 with a success-shaped fake** (`data` = echo of the comment with a random uuid) and persist nothing — bots must not learn they were caught.
4. shape: `targetType` enum, `targetId` ≤ 120 chars, body trimmed 2–2000 (→ 400 `invalid_body` / `too_long`), `guestName` trimmed ≤ 40, blank → null; `guestName` ignored when signed in.
5. link count > 1 → 400 `too_many_links`, message `"max 1 link per comment"`.
6. blocklist (`src/lib/engagement/blocklist.ts`): base word array in code merged with `BLOCKLIST_EXTRA` env (comma-separated); case-insensitive word-boundary match against body **and** guest name, after stripping zero-width chars → 422 `blocked_content`, message `"comment blocked by filters"` (deliberately unspecific; the matched term is logged server-side, never returned).
7. target existence → 400 `invalid_target`.
8. dedupe: `body_hash` + target with `created_at > now() - interval '10 minutes'` exists → 409 `duplicate`.
9. insert; respond 201 `{ data: CommentDTO }`.

`GET /api/admin/comments?status=all|published|hidden&limit=50&cursor=<iso>` — admin session only (401 `auth_required` / 403 `forbidden`). returns newest-first `{ data: { comments: [ …CommentDTO + { targetType, targetId, email: string|null, ipHashPrefix: "8chars", status } ], nextCursor: "iso|null" } }`.

`PATCH /api/admin/comments/[id]` — admin. body `{ "status": "hidden" | "published" }` → 200 `{ data: { id, status } }`; 404 `invalid_target` if no row.

`DELETE /api/admin/comments/[id]` — admin. hard delete → 200 `{ data: { id, deleted: true } }`.

**likes**

`POST /api/likes` — signed-in only; guests → 401 `auth_required` (the client shows the sign-in prompt instead of ever calling this, but the route still enforces). body `{ "targetType", "targetId" }`. rate limit 30/min per user. toggle semantics: `insert … on conflict do nothing`; if 0 rows inserted, `delete`. response 200 `{ "data": { "liked": true, "count": 13 } }` (count re-selected after toggle; idempotent under retries).

**claps**

`POST /api/claps` — anyone. body `{ "targetType", "targetId", "count": 1–20 }` (else 400 `invalid_body`). rate limit 10 requests/min per ip-hash. grant logic is a single postgres statement so the cap holds atomically without interactive transactions (neon-http has none):

```sql
with before as (
  select count from clap_daily
  where ip_hash=$1 and target_type=$2 and target_id=$3 and day=current_date
), upsert as (
  insert into clap_daily (ip_hash, target_type, target_id, day, count)
  values ($1, $2, $3, current_date, least($4, 60))
  on conflict (ip_hash, target_type, target_id, day)
  do update set count = least(60, clap_daily.count + $4)
  returning count
)
select coalesce((select count from before), 0) as before_count,
       (select count from upsert)              as after_count;
```

`granted = after - before`; then `insert into clap_totals … on conflict do update set count = clap_totals.count + granted` (skipped when granted = 0). if the totals update fails after the ledger succeeded, log `log.error` and return the error — a few claps under-counted is acceptable; the order (ledger first) means retries can never exceed the cap. response 200 `{ "data": { "accepted": 7, "total": 347, "remainingToday": 53 } }`. note: route must tolerate `navigator.sendBeacon` bodies (json blob, no custom headers).

**views**

`POST /api/views` — anyone. body `{ "targetType", "targetId" }`. rate limit 30/min per ip-hash. secondary dedupe: redis `SET key NX EX 1800` on `views:<iphash>:<type>:<id>` — already set → return current count without incrementing; redis down → skip dedupe (fail open, approximate counter). increment: `insert … on conflict do update set count = view_counts.count + 1 returning count`. response 200 `{ "data": { "count": 1290 } }`.

---

## ui/ux

everything lowercase; funnel sans; existing classes only (`card-bg`, `link-highlight`, `link-highlight-active`, `text-gray`, `text-off-white`, `text-secondary`, `section-divider`, `animate-content-enter`) plus css variables (`--theme-divider`, `--theme-card-bg`, `--theme-text-muted`). no new design language, no modal/toast/ui libraries. all inline svg icons use `stroke="#EEEEEE"` (never `currentColor`, per repo convention) with a new `.engagement-icon` class in `globals.css` that applies `filter: invert(1)` under `.theme-light` — the exact pattern of the existing `theme-light img[src*="/icons/"]` rule. buttons ≥ 44px touch targets via padding (mobile-first; these pages are read on phones).

**placement (three one-block page edits)**

- `src/app/blog/[slug]/page.tsx`: after `</article>`, before the adjacent-posts block:
  ```tsx
  <div className="section-divider" />
  <section className="py-4" style={{ maxWidth: "720px" }}>
    <EngagementSection targetType="blog" targetId={post.slug} />
  </section>
  ```
- `src/app/photos/[slug]/page.tsx`: same block after the `PhotosetViewer` section, before the existing `section-divider`, with the same 720px cap (viewer stays full-width above it).
- `src/app/activities/[id]/page.tsx` (ws2): same block at the bottom of the page, above the footer, `targetId={String(activity.id)}`.

**`EngagementSection` (client, `src/components/engagement/EngagementSection.tsx`)**

wraps its own `<SessionProvider>` (from `next-auth/react`) so `src/app/layout.tsx` is never touched. on mount: one `GET /api/engagement`; fires `POST /api/views` iff `sessionStorage["v:<type>:<id>"]` unset (set the flag *before* the fetch + a `useRef` guard, so react strict-mode double-effects and the api dedupe can't double-count). shape-validates the payload with a new `isEngagementPayload` guard in `src/lib/validate.ts` before `setState` (the Currently.tsx crash-class lesson).

states:

- **loading**: render row 1 buttons immediately with no counts (icons only, counts fade in via `animate-content-enter` when data lands). no spinner.
- **degraded** (fetch failed / 503 / invalid shape): render `null`. the whole section disappears quietly; the static article above is untouched. `console.warn` only.

**row 1 — like · clap · views** (`EngagementRow.tsx`, flex row, `gap-6`, `py-2`)

- **like** (`LikeButton.tsx`): heart outline svg (20px, `stroke="#EEEEEE"`, `strokeWidth 1.5`, `fill="none"`; liked → `fill="#EEEEEE"`), count beside it in `font-sans text-gray text-sm`. transparent button, `padding: 12px`, hover shifts count to `text-off-white` (matches `link-highlight` hover feel). signed-in click → optimistic toggle, `POST /api/likes`, revert + brief `text-gray` "couldn't save" inline text on failure. guest click → **sign-in prompt** (below).
- **clap** (`ClapButton.tsx`): clapping-hands outline svg (same stroke rules), count beside it. each press: optimistic `count+1`, icon `transform: scale(1.15)` for 120ms, and a small floating `+n` span (`text-gray text-xs`, `animate-content-enter`, absolutely positioned above the icon, fades out). batching: presses accumulate in a ref; flush after **800ms idle** via `fetch(..., { keepalive: true })`, and on `pagehide`/`visibilitychange: hidden` via `navigator.sendBeacon`. server response reconciles the count (`accepted < sent` when the daily cap bites — count snaps down, no message; hitting the cap is silent by design). local disable at `remainingToday === 0` (button gets `opacity: 0.4`, presses ignored).
- **views**: right-aligned (`marginLeft: auto`) `font-sans text-gray text-sm` — `1,289 views`. hidden entirely if views fetch/increment failed. this is the *only* place views render (no server-rendered header edits — keeps the static pages untouched).

**guest sign-in prompt** (`SignInPrompt.tsx`) — not a modal. a `position: relative` wrapper on the like button anchors an absolutely-positioned card below it: `card-bg` + `border: 1px solid var(--theme-divider)`, `borderRadius: 8px`, `padding: 0.75rem 1rem`, `z-10`, ~240px wide, `animate-content-enter`. content: `sign in to like` (`text-secondary text-sm`), then two inline actions: `sign in with google` (`text-off-white text-sm link-highlight`, calls `signIn("google", { callbackUrl: window.location.href })`) and `not now` (`text-gray text-sm link-highlight`, dismisses). dismiss on escape and outside click. on mobile the card is `max-width: calc(100vw - 40px)` and clamped inside the viewport.

**comments block** (`Comments.tsx`, below row 1 with `marginTop: 1.5rem`)

- header: `comments` in `font-sans text-off-white text-lg`, count in `text-gray` — `comments · 3`. zero comments: form only, no empty-state copy.
- list (`CommentItem.tsx`): flat rows separated by `border-bottom: 1px solid var(--theme-divider)`, `padding: 0.75rem 0` — no per-comment cards (matches the site's list-not-card feel). row layout: 20px `border-radius: 50%` avatar `<img>` when `avatar` present (nothing for guests — no placeholder circle), name `font-sans text-off-white text-sm`, `·`, date via the page's short-date format (`jul 6, 2026`) in `text-gray text-sm`; body below in `font-sans text-secondary text-base` with `whiteSpace: pre-wrap; overflowWrap: anywhere`. body is rendered as plain text (react-escaped) — never markdown/html; urls are NOT auto-linkified (spam seo denial).
- admin extras (when `viewer.isAdmin`): trailing `hide · delete` in `text-gray text-xs link-highlight`; delete requires a second tap (`delete?` confirm swap, no `window.confirm`).
- form (`CommentForm.tsx`) below the list:
  - guest: `name (optional)` input, then textarea placeholder `add a comment`. signed-in: textarea only, with `commenting as andrew · sign out` above it in `text-gray text-sm` (`sign out` is `link-highlight`).
  - inputs: `card-bg`, `border: 1px solid var(--theme-divider)`, `borderRadius: 6px`, `padding: 0.5rem 0.75rem`, `font-sans text-base text-secondary`, focus → `borderColor: var(--theme-text-muted)`, `outline: none`. textarea `minHeight: 6rem`, `resize: vertical`, `width: 100%`.
  - honeypot: `<div aria-hidden="true" style={{ position: "absolute", left: "-9999px" }}><input name="website" tabIndex={-1} autoComplete="off" /></div>`.
  - char counter appears only past 1800 chars: `1923 / 2000` in `text-gray text-xs`.
  - submit: `<button>` labeled `post comment`, `font-sans text-sm text-off-white link-highlight-active`, disabled (opacity 0.4) while empty or in-flight.
  - errors render inline under the button in `text-gray text-sm` (quiet, no red): `rate_limited` → `slow down — try again in a minute`; `too_many_links` → `max 1 link per comment`; `blocked_content` → `comment blocked by filters`; `duplicate` → `looks like a repeat — already posted?`; network/503 → `couldn't post — try again later`.
  - success: comment appends to the list (server response only — never optimistic, filters must pass), textarea clears.

**admin moderation page** (`src/app/admin/comments/page.tsx` + `AdminComments.tsx` client component) — mounts in the ws2 `/admin` shell; if the shell's nav registry exists, add a `comments` entry, otherwise the page stands alone with a `← admin` back link (`text-gray link-highlight`). content: filter chips `all / published / hidden` using the `link-highlight` / `link-highlight-active` chip pattern from the blog index; newest-first list, each row a `card-bg` block (`borderRadius: 8px`, `padding: 0.75rem 1rem`, `marginBottom: 0.5rem`): line 1 `name · email-or-anon · ip 8-char-prefix · jul 6, 2026` (`text-gray text-sm`) with a right-aligned target link `blog / hello-world ↗` (`link-highlight`); line 2 body (`text-secondary`, clamped to 4 lines, tap to expand); line 3 actions `hide`/`unhide` + `delete` (two-tap confirm). `load more` button drives cursor pagination. hidden rows render at `opacity: 0.5` with a `hidden` tag. mobile: single column, everything wraps.

**blocklist editing**: not in the ui. v1 = code constant + `BLOCKLIST_EXTRA` env var (change in vercel dashboard → redeploy). documented in the admin page footer as a `text-gray text-xs` note.

---

## implementation plan

steps 1–3 are strictly ordered; after step 3, tracks a/b/c are parallelizable (disjoint files); step 8 last.

1. **db foundation** — files: `package.json` (deps + `db:generate`/`db:migrate` scripts), `drizzle.config.ts`, `src/lib/db/schema.ts` (all ddl from §data model as drizzle tables; export table objects + inferred types), `src/lib/db/client.ts`, generated `drizzle/0000_*.sql`. run migration against neon. (if ws2 already created `src/lib/db/*`, extend the existing schema file instead — same ddl.)
2. **auth** — files: `src/lib/auth.ts` (NextAuth config per §api surface: google provider, drizzle adapter, jwt strategy, `uid`/`isAdmin` claims, `isAdminSession()` helper), `src/app/api/auth/[...nextauth]/route.ts` (`export const { GET, POST } = handlers`). google cloud console: oauth client, redirect uri `https://www.andrewzhou.org/api/auth/callback/google` (+ localhost). smoke-test sign-in on a preview deploy before proceeding.
3. **abuse/shared libs** — files: `src/lib/engagement/constants.ts` (all knobs from §data model), `src/lib/engagement/ip.ts` (`getIpHash(request)`: `x-forwarded-for` first hop → sha256 with `IP_HASH_SALT`; returns null when salt unset), `src/lib/engagement/ratelimit.ts` (lazy `@upstash/ratelimit` instances per route reusing the `KV_REST_API_*` redis client; `checkLimit()` wrapper that fails open with `log.warn`), `src/lib/engagement/blocklist.ts`, `src/lib/engagement/filter.ts` (pure: `countLinks`, `normalizeBody`, `bodyHash`, `matchesBlocklist`, `validateCommentInput` returning a typed result), `src/lib/engagement/targets.ts` (+ add `photosetExists(slug)` to `src/lib/photos.ts` — content-yaml existence check only), `src/lib/engagement/types.ts` (DTOs), shared route helpers `src/lib/engagement/http.ts` (`ok()`, `fail(code, status)`, `assertSameOrigin`, writes-disabled check). also: `next.config.ts` `outputFileTracingIncludes` for the engagement/comments routes.
4. **track a — api routes** (parallel with b, c) — files: `src/app/api/engagement/route.ts` (GET aggregate, `db.batch`), `src/app/api/comments/route.ts` (POST pipeline), `src/app/api/likes/route.ts` (POST toggle), `src/app/api/claps/route.ts` (POST grant cte + totals + opportunistic `clap_daily` purge), `src/app/api/views/route.ts` (POST increment + redis nx dedupe), `src/app/api/admin/comments/route.ts` (GET list), `src/app/api/admin/comments/[id]/route.ts` (PATCH/DELETE). every route: envelope, `force-dynamic`, structured logs.
5. **track b — public ui** (parallel with a, c) — files: `globals.css` (append `.engagement-icon` light-mode invert rule only — nothing else), `src/lib/validate.ts` (add `isEngagementPayload`), `src/components/engagement/EngagementSection.tsx`, `EngagementRow.tsx`, `LikeButton.tsx`, `ClapButton.tsx`, `SignInPrompt.tsx`, `Comments.tsx`, `CommentItem.tsx`, `CommentForm.tsx`, `icons.tsx` (heart + clap inline svgs, `stroke="#EEEEEE"`). build against a mocked fetch first so track a isn't a blocker.
6. **track c — admin ui** (parallel with a, b once 2 is done) — files: `src/app/admin/comments/page.tsx`, `src/components/engagement/AdminComments.tsx`.
7. **page integration** — the three placement edits from §ui/ux: `src/app/blog/[slug]/page.tsx`, `src/app/photos/[slug]/page.tsx`, `src/app/activities/[id]/page.tsx` (ws2 file). plus `scripts/delete-user.ts`.
8. **hardening pass** — run the §testing plan suites, verify degraded modes by pointing `DATABASE_URL` at a dead host locally (engagement section must vanish, pages render), verify redis-down fail-open by unsetting `KV_REST_API_URL` locally, verify honeypot + blocklist + dedupe against curl, set vercel env vars, deploy preview, then production.

---

## dependencies

npm (exact additions to `package.json`):

- `drizzle-orm` — typed postgres schema/queries; shared client choice with ws2; required by the auth adapter.
- `drizzle-kit` (dev) — generates plain-sql migrations committed to `drizzle/`.
- `@neondatabase/serverless` — neon http driver; one https request per query, no pool management in vercel functions.
- `next-auth@5.0.0-beta.x` (**pin exact version**) — auth.js v5 app-router handlers, google provider, jwt sessions.
- `@auth/drizzle-adapter` — persists users/accounts to neon through the same drizzle client.
- `@upstash/ratelimit` — sliding-window rate limits on the already-provisioned upstash redis (`@upstash/redis` already in deps).

no zod (hand-rolled guards per the existing `src/lib/validate.ts` pattern), no ui libraries, no icon packages (two inline svgs).

env vars to add (vercel + `.env.local`):

| var | purpose |
|---|---|
| `DATABASE_URL` | neon pooled connection string (may already exist from ws2) |
| `AUTH_SECRET` | auth.js jwt/cookie signing (`openssl rand -base64 32`) |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | google oauth client |
| `ADMIN_EMAILS` | comma-separated allowlist; code default `andrew06zhou@gmail.com` |
| `IP_HASH_SALT` | salt for ip hashing; **writes fail closed if unset** |
| `BLOCKLIST_EXTRA` | optional comma-separated additions to the code blocklist |
| `ENGAGEMENT_WRITES_DISABLED` | optional kill switch: `true` → all engagement POSTs return 503 `disabled` |

existing `KV_REST_API_URL` / `KV_REST_API_TOKEN` are reused for rate limiting + view dedupe. no changes to `ADMIN_API_SECRET` or `STRAVA_API_ENABLED`.

---

## failure modes & observability

log sources (via `src/lib/log.ts`, one json line each): `api:engagement`, `api:comments`, `api:likes`, `api:claps`, `api:views`, `api:admin-comments`, `engagement:filter`, `engagement:ratelimit`, `db:engagement`, `auth`.

| failure | user sees | logged |
|---|---|---|
| neon down — reads | engagement section absent; article/photoset/activity renders normally (static pages never touch neon) | `error` `api:engagement` "db read failed" |
| neon down — writes | comment: `couldn't post — try again later`; like: optimistic state reverts + `couldn't save`; claps: count snaps back; views: silently uncounted | `error` per route |
| neon down — sign-in | google flow errors (adapter insert fails); existing jwt sessions keep working | `error` `auth` |
| upstash down | rate limits + view dedupe **fail open**: everything works, caps unenforced for the outage window; postgres-enforced clap daily cap and comment dedupe still hold | `warn` `engagement:ratelimit` "redis unavailable, failing open" (once per request, not per limiter) |
| `IP_HASH_SALT` unset | all engagement writes 503; reads fine | `error` per route "IP_HASH_SALT unset — writes disabled" |
| honeypot trip | bot sees fake 201; nothing stored | `info` `engagement:filter` "honeypot hit" + ip-hash prefix |
| blocklist trip | `comment blocked by filters` | `info` `engagement:filter` + matched term + ip-hash prefix (body never logged) |
| rate limit trip | 429 → `slow down — try again in a minute` | `info` `engagement:ratelimit` + route + ip-hash prefix |
| clap totals update fails after ledger grant | clap count under-reports by ≤ 20 | `error` `api:claps` "totals increment failed after grant" |
| spam wave despite filters | owner sets `ENGAGEMENT_WRITES_DISABLED=true` (reads stay up), deletes via admin, adds `BLOCKLIST_EXTRA` terms, redeploys | `info` on every rejected write with code `disabled` |
| malformed GET payload reaching client | `isEngagementPayload` fails → section hides (no crash — Currently.tsx lesson) | client `console.warn` |
| `next-auth` beta regression on upgrade | prevented: version pinned; upgrades only via preview-deploy smoke test | — |

client components never throw on engagement failures (all fetches wrapped, all payloads shape-checked); the pages' existing `error.tsx` boundaries are a last resort, not a plan.

---

## testing plan

vitest, following the existing `vi.hoisted` + `vi.mock` route-test pattern in `src/app/api/__tests__/strava-refresh-route.test.ts`.

- `src/lib/engagement/__tests__/filter.test.ts` — link counting (`http`, `https`, `www.`, multiples, none); length bounds incl. trim; guest-name cap + blank→null; blocklist word-boundary matching (no substring false positives, e.g. a term embedded in a longer word), case-insensitivity, zero-width stripping, `BLOCKLIST_EXTRA` merge; `normalizeBody`/`bodyHash` stability (whitespace/case variants collide, distinct bodies don't).
- `src/lib/engagement/__tests__/ip.test.ts` — deterministic hash for same ip+salt, different across salts, null when salt unset, `x-forwarded-for` first-hop parsing.
- `src/lib/engagement/__tests__/targets.test.ts` — blog/photos existence via mocked fs loaders, activity via mocked db, unknown type rejected.
- `src/app/api/__tests__/comments-route.test.ts` — mocked db/ratelimit/auth: honeypot returns success-shape without insert; each rejection code with correct status (400/422/409/429); dedupe window query; signed-in ignores `guestName`; kill switch 503; salt-unset 503; same-origin 403.
- `src/app/api/__tests__/claps-route.test.ts` — grant math from mocked `before/after` rows (fresh day, partial grant at cap, zero at cap), batch bounds (0, 21 rejected), totals-failure path still returns error envelope, `remainingToday` arithmetic.
- `src/app/api/__tests__/likes-route.test.ts` — guest 401, insert-then-conflict toggling, count in response.
- `src/app/api/__tests__/views-route.test.ts` — increments once, redis-nx short-circuit, redis-down fail-open still increments.
- `src/app/api/__tests__/engagement-route.test.ts` — aggregate happy path, hidden comments excluded, `likedByMe`/`mine` per session, `invalid_target` 400, db-down 503 envelope.
- `src/app/api/__tests__/admin-comments-route.test.ts` — non-admin 401/403, hide/unhide/delete, cursor pagination.
- `src/lib/__tests__/validate.test.ts` (extend) — `isEngagementPayload` accepts the contract, rejects `{fetchedAt}`-style partials, null, missing counts.

not unit-tested (manual checklist in step 8): google oauth round-trip, sendBeacon flush, sessionStorage strict-mode guard, light-mode icon inversion, mobile touch targets.

---

## risks & open questions

1. **`next-auth` v5 beta stability** — it has been beta for a long time; api churn between betas is real. *recommendation*: pin the exact version, upgrade only via preview-deploy smoke tests. accept.
2. **blocklist lives in a public repo** — spammers can read the base list. *recommendation*: accept for v1 (deterrent, not a wall); sensitive/hot additions go in `BLOCKLIST_EXTRA` (env, not visible); db-backed list is a ws3+ follow-up if abused.
3. **rate limits fail open when redis dies** — a spammer during an upstash outage faces only the postgres dedupe + honeypot + blocklist. *recommendation*: accept (the hard constraint is "site keeps working"); `ENGAGEMENT_WRITES_DISABLED` is the manual backstop. alternative (fail-closed for comments only) rejected as violating the degrade-quietly principle.
4. **no approval queue means spam is visible until you delete it** — *recommendation*: accept per locked scope; the admin list + kill switch bound the blast radius. revisit llm screening only if actual spam volume warrants.
5. **clap cap = 60/ip/target/day, batch ≤ 20** — needs owner sign-off on the number. *recommendation*: 60 (medium uses 50/user; ip-hash is coarser so slightly higher keeps shared-nat users happy).
6. **guest names optional, rendered `anon`** — *recommendation*: yes, optional; requiring names adds friction and fake names anyway.
7. **store + display google avatar urls** — slightly more pii than name/email alone. *recommendation*: yes — comments read much better with avatars, and it's the user's public google avatar; deletion wipes it. if you want stricter minimalism, drop the `image` column and the 20px `<img>` (one-line changes each).
8. **account deletion is manual (email → script)** — *recommendation*: accept for v1; document nothing on-page beyond the existing contact link. self-serve delete is trivial to add later (`DELETE /api/me`) if anyone ever asks.
9. **ws2 coupling** — this design assumes drizzle + neon-http as the shared db client and an `activities` table with a stable id. if ws2 ships raw sql instead, keep this doc's ddl verbatim and swap `schema.ts` usage for tagged-template queries; the auth adapter is the only piece that genuinely wants drizzle. *recommendation*: make drizzle the ws2 choice now to avoid two clients.
10. **library entries excluded from engagement** — scope lists blog/photos/activities only; `target_type` check constraint enforces it. adding library later = extend the enum + one placement edit in `src/app/library/[slug]/page.tsx`. *recommendation*: confirm exclusion is intentional (the library detail page is structurally identical to blog, so inclusion is cheap if wanted).
