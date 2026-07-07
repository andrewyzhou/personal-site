# WS3 — admin cms

detailed design for workstream 3 (item 8): git-backed content crud, mdxeditor authoring, leetcode entry, unified admin calendar, and deploy feedback. builds on the WS2 admin shell (auth.js google session, `/admin` layout, blob upload endpoint, client image-downscale util) and the locked architecture in `docs/PLAN.md` §6. all file paths below are relative to the repo root (`/Users/andrewzhou/Desktop/projects/personal/personal-site`).

## overview (goals, non-goals)

**goals**

- every file under `content/` becomes editable from `/admin` on a phone: blog posts, library entries, photo essays, experience items (work/research/teaching/projects), and the four singletons (`bio.mdx`, `sections.yaml`, `coursework.yaml`, `hero-quotes.yaml`). writes go through the github contents api as commits to `andrewyzhou/personal-site` `main`, authored by the owner's fine-grained PAT so the github activity graph is preserved. conventional lowercase commit messages (`content: add blog post <slug>`).
- frontmatter is never hand-written again: per-type structured form fields (derived from the exact interfaces in `src/lib/blog.ts`, `library.ts`, `photos.ts`, `items.ts`, `content.ts`) sit above an mdxeditor body editor restyled to the monochrome theme, with a faithful "how it renders" preview.
- a "+" menu lists every creatable type; leetcode entries get a dedicated form that commits to `andrewyzhou/leetcode` with the `"N. Title (Difficulty)"` message the existing parser (`src/lib/leetcode.ts:parseCommitMessage`) consumes, with url-paste autofill via leetcode's public graphql — fully gated, never blocking save.
- browse/manage per type: search, sort, edit (round-trips existing files through the same forms), publish/unpublish (move to/from `wip/` in a single commit), delete with confirm, all sha-guarded against upstream drift.
- a unified multi-month admin calendar generalizing the `ActivityCalendar` view-state machine: all event types (activities from neon, leetcode, github commits, blog, library, photo essays) with per-type icons and blurred-thumbnail day cells; multi-month grid → month → day → entry drill-down; doubles as a browse ui.
- deploy feedback after every content commit: optimistic "rebuilding" note + live status polled from github deployment statuses (vercel writes them), degrading to a plain link.
- the site keeps working when github, leetcode, neon, or redis die: degraded states, local draft preservation, structured logs via `src/lib/log.ts`.

**non-goals**

- no redesign of the public single-month `ActivityCalendar` (`src/components/ActivityCalendar.tsx`) — it is untouched. the admin calendar is a new component.
- no bulk css/styling refactors of existing components. the only existing-component edit permitted in this workstream is a small additive prop on `Figure` (`src/components/blog/mdx.tsx`) to support blob-hosted images (see §implementation step 6).
- no offline write queue for github outages (decision below: error clearly + local draft).
- no photo-essay *block editor* (image|gallery|text blocks + exif sidebar) — that ui is WS6. WS3 ships the generic yaml round-trip, the photoset form for the current schema, and the blob upload plumbing WS6 will reuse; the yaml v2 format is specified here so WS6 and WS3 agree.
- no slug rename flow in v1 (workaround: create new + delete old).
- no editing of `content/blog/README.md` / other readmes from the cms (they remain desktop-edited docs).
- leetcode detail pages: still skipped (PLAN WS2 decision).
- comment moderation ui: WS5 (it will mount inside the `/admin` shell but is specified there).

## data model (exact table/schema DDL or file formats, with types)

WS3 adds **no new postgres tables**. git is the system of record for everything this workstream writes; redis is cache only. the data model is therefore (a) file formats, (b) a typescript content registry, (c) redis cache keys, (d) client-side draft format, (e) the calendar event union.

### a. content file formats (must match the existing loaders exactly)

**blog post** — `content/blog/<slug>.mdx` (published) or `content/blog/wip/<slug>.mdx` (draft). slug rule everywhere: `/^[a-z0-9][a-z0-9-_]*$/` (mirrors `isValidSlug` in `src/lib/blog.ts`).

```yaml
---
title: string          # required
date: 2026-07-06       # required, iso yyyy-mm-dd (serialize unquoted; loader normalizes via toISODate)
summary: string        # required
tags: [a, b]           # required, may be []
cover: /blog/<slug>/cover.jpg   # optional; new posts may use a blob url (https://…public.blob.vercel-storage.com/…)
pinned: true           # optional, omit when false
---
<mdx body>
```

**library entry** — `content/library/<slug>.mdx` / `content/library/wip/<slug>.mdx`:

```yaml
---
title: string                     # required
creator: string                   # required
type: book|video|podcast|course|article   # required (LibraryType union)
sourceUrl: string                 # optional url
dateStarted: 2026-01-01           # optional iso date
dateCompleted: 2026-02-01         # optional iso date (presence ⇒ status "completed")
rating: number                    # optional
tags: [a, b]                      # required, may be []
summary: string                   # required
---
<mdx body>
```

**photo essay (photoset)** — `content/photos/<slug>.yaml` / `content/photos/wip/<slug>.yaml`. v1 (current `PhotosetFrontmatter` in `src/lib/photos.ts`, images in `public/photos/<slug>/`):

```yaml
title: string
date: 2026-05-15
caption: string
cover: cover.jpg          # filename inside public/photos/<slug>/
photos: [cover.jpg, 01.jpg]   # ordered filenames
```

v2 (WS6 coordination — specified now, implemented by WS6; WS3's generic yaml editor must not corrupt it): discriminated by a `format: blocks` key; absence of the key means v1.

```yaml
format: blocks
title: string
date: 2026-05-15
cover:                       # blob-hosted images carry url + dimensions (image-size can't read remote)
  src: https://<store>.public.blob.vercel-storage.com/content/photos/<slug>/cover.jpg
  width: 2000
  height: 1333
  alt: string
blocks:
  - kind: text
    body: string             # markdown paragraph(s)
  - kind: image
    src: https://…           # or /photos/<slug>/file.jpg for legacy local files
    width: 2000
    height: 1333
    alt: string
    caption: string          # optional
    exif: { camera: string, aperture: string, shutter: string, iso: number }   # optional
    coords: { lat: number, lon: number }                                      # optional
  - kind: gallery
    images: [ { src, width, height, alt, caption? } ]
```

**experience item** — `content/{work,research,teaching,projects}/<slug>.mdx` (no wip convention today; `getItems` in `src/lib/items.ts` reads all direct-child `.mdx`; the cms does not create `wip/` for these types):

```yaml
---
order: 1                 # required number, lower sorts first (default 99)
title: string            # required
company: string          # required
companyUrl: string       # optional
location: string         # optional
period: may 2026 – aug 2026   # optional
year: "2026"             # required, serialized quoted (string, not number)
---
<mdx bullet-list body>
```

**singletons**

- `content/bio.mdx` — no frontmatter, pure mdx body (contains inline jsx like `<span className="hidden md:inline">` — the editor must round-trip it, see ui section).
- `content/sections.yaml` — `Record<SectionKey, string>` where `SectionKey` is the 8-key union in `src/lib/content.ts` (`work|research|teaching|projects|library|blog|photos|coursework`). empty string allowed (blog blurb currently empty).
- `content/coursework.yaml` — `Semester[]`: `{ name: string, courses: { code: string, title: string, cheatsheets?: { label: string, url: string }[] }[] }[]`. trailing `*` on a title flags external-accredited courses (helper text in the form, not a schema field).
- `content/hero-quotes.yaml` — `{ text: string (multiline), attribution: string }[]`. js-yaml `dump` emits multiline strings as `|-` block literals automatically — covered by a round-trip test.

> **comment loss (accepted)**: js-yaml and gray-matter drop yaml comments on serialize. the guidance comments currently at the top of `sections.yaml`, `coursework.yaml`, `hero-quotes.yaml` will be lost on first cms save. mitigation: that guidance moves into the admin form helper text; noted in risks.

### b. content registry (single source of truth for the cms)

`src/lib/admin/content-registry.ts`:

```ts
export type ContentTypeId =
  | "blog" | "library" | "photos"
  | "work" | "research" | "teaching" | "projects"
  | "bio" | "sections" | "coursework" | "hero-quotes";

export interface ContentTypeDef {
  id: ContentTypeId;
  label: string;                 // lowercase display name, e.g. "blog post"
  kind: "mdx" | "yaml";
  singleton: boolean;            // bio/sections/coursework/hero-quotes
  dir: string;                   // e.g. "content/blog"; singletons use exact path e.g. "content/bio.mdx"
  hasWip: boolean;               // blog, library, photos true; experience + singletons false
  commitNoun: string;            // "blog post", "library entry", "photo essay", "work item", "bio", …
  validate(frontmatter: unknown, body: string): string[];  // returns human-readable errors, [] = ok
  serialize(frontmatter: Record<string, unknown>, body: string): string; // exact file text
  parse(raw: string): { frontmatter: Record<string, unknown>; body: string };
}
export const CONTENT_TYPES: Record<ContentTypeId, ContentTypeDef>;
```

serialization rules (in `src/lib/admin/frontmatter.ts`): mdx types use `gray-matter`'s `matter.stringify(body, frontmatter)`; yaml types use `js-yaml` `dump(data, { lineWidth: -1, noRefs: true, quotingType: '"' })`. optional fields with empty values are **omitted**, not serialized as `null`/`""` (except `sections.yaml` values, which may be empty strings). `date` fields serialize unquoted iso (the loaders' `toISODate` normalizes either way). `year` on experience items is force-quoted. key order fixed per type (matches the field order in §a) so diffs stay clean.

### c. github write model

- content repo: `andrewyzhou/personal-site`, branch `main`. leetcode repo: `andrewyzhou/leetcode`, branch `main` (confirm default branch at implementation; the commits endpoint in `src/lib/leetcode.ts` doesn't pin one).
- create/update: `PUT /repos/{owner}/{repo}/contents/{path}` with `{ message, content: base64, branch, sha? }`. update requires the file's current blob `sha`; github returns **409** on sha mismatch and **422** when creating a path that already exists — both mapped to typed errors.
- delete: `DELETE /repos/{owner}/{repo}/contents/{path}` with `{ message, sha, branch }`.
- move (publish/unpublish) is a **single commit** via the git data api so history stays clean and the operation is atomic: `GET git/ref/heads/main` → `GET git/commits/{sha}` → `POST git/trees` with `base_tree` and two entries (`{path: newPath, mode: "100644", type: "blob", sha: blobSha}`, `{path: oldPath, sha: null}`) → `POST git/commits` → `PATCH git/refs/heads/main` (`force: false`; a non-fast-forward here = concurrent commit → retry once, then surface conflict).
- commit messages (all lowercase, conventional):
  - `content: add <noun> <slug>` / `content: edit <noun> <slug>` / `content: delete <noun> <slug>`
  - `content: publish <noun> <slug>` / `content: unpublish <noun> <slug>`
  - singletons: `content: edit bio`, `content: edit sections`, `content: edit coursework`, `content: edit hero quotes`
  - leetcode repo: exactly `` `${number}. ${title} (${Difficulty})` `` with `Difficulty ∈ Easy|Medium|Hard` capitalized — matches `parseCommitMessage`'s regex `/^(\d+)\.\s+(.+?)\s+\((Easy|Medium|Hard)\)/i`.
- leetcode solution path convention: default `${number}-${kebab(title)}.${ext}` at repo root with `ext` from a language map (`python→py, java→java, cpp→cpp, c→c, javascript→js, typescript→ts, go→go, rust→rs, sql→sql`); the path is a computed-but-editable form field (see risks — the repo's real layout must be confirmed and the default adjusted before ship). the parser only reads commit messages, so the path is cosmetic but should match existing files.

### d. redis cache keys (cache only, never system-of-record; all writes wrapped in try/catch like `src/lib/cache.ts`)

| key | value | ttl | purpose |
|---|---|---|---|
| `cms:list:<type>` | `ContentListItem[]` (see api) | 60 s | browse lists; deleted (best-effort) after any successful write to that type |
| `cms:fm:<blobSha>` | parsed frontmatter json | 30 d | frontmatter by immutable blob sha — makes tree-walk listing cheap |
| `lc:q:<titleSlug>` | `{ number, title, difficulty }` | 30 d | leetcode graphql lookup successes only (per `docs/research/leetcode-graphql.md`); failures never cached |
| `cms:deploy:<commitSha>` | `{ state, url, checkedAt }` | 1 h | deploy-status poll memo (10 s min-interval guard) |

### e. client-side draft format (localstorage, survives github outages and tab closes)

key `admin:draft:<type>:<slug|new>`, value:

```ts
interface LocalDraft {
  frontmatter: Record<string, unknown>;
  body: string;
  baseSha: string | null;   // sha the edit started from (null for new)
  savedAt: number;          // ms epoch
}
```

written on a 2 s debounce while editing; cleared on successful commit; on editor mount, if a draft exists and differs from the loaded file, show a "restore local draft from <time>? restore / discard" bar.

### f. admin calendar event union

`src/lib/admin/calendar-events.ts`:

```ts
export type AdminCalendarEvent =
  | { kind: "activity"; id: string; date: string; startTime: string; type: string; name: string }   // from neon via WS2
  | { kind: "leetcode"; sha: string; date: string; problemNumber: number; problemTitle: string;
      difficulty: "easy" | "medium" | "hard"; url: string }                                          // LeetCodeSubmission
  | { kind: "commit"; date: string; count: number }                                                  // github contributions, one event per day
  | { kind: "blog"; slug: string; date: string; title: string; status: "published" | "wip"; thumb?: string }
  | { kind: "library"; slug: string; date: string; title: string; status: "published" | "wip" }      // date = dateCompleted ?? dateStarted; undated entries excluded
  | { kind: "photos"; slug: string; date: string; title: string; status: "published" | "wip"; thumb?: string };

export interface AdminCalendarPayload {
  events: AdminCalendarEvent[];
  sources: Record<"activities" | "leetcode" | "commits" | "content", "ok" | "error">;
}
```

`thumb` resolution: blog `cover` used verbatim (local `/blog/…` path or blob url); photoset v1 cover = `/photos/<slug>/<cover>`, v2 cover = `cover.src`.

## api surface (every route: method, path, auth, request/response shapes, failure envelopes)

conventions for **all** routes below:

- auth: auth.js session where `session.user.email` is in the admin allowlist (`andrew06zhou@gmail.com`), enforced server-side via the WS2 helper (assumed `requireAdminSession()` in `src/lib/admin-session.ts`; if WS2 named it differently, adapt — do not re-implement). unauthenticated/unauthorized → `401 { "error": { "code": "unauthorized", "message": "sign in required" } }`. these routes use session auth from day one — they never use the ws0 `ADMIN_API_SECRET` header (`src/lib/admin-auth.ts` stays only on the pre-existing ws0 endpoints until WS2 migrates them).
- `export const dynamic = "force-dynamic"` and `export const runtime = "nodejs"` on every route (buffer base64, no caching).
- success envelope: `200/201 { "data": … }`. failure envelope: `{ "error": { "code": string, "message": string, "details"?: unknown } }` with codes: `unauthorized` (401), `validation` (400), `not_found` (404), `conflict` (409), `exists` (409), `rate_limited` (429), `github_unavailable` (502), `internal` (500). every github failure is logged via `log.error("github:content", …)` before returning.

### content crud

**`GET /api/admin/content/[type]`** — list entries (collections only; 400 for singletons).
response `data`: `ContentListItem[]`:

```ts
interface ContentListItem {
  slug: string;
  status: "published" | "wip";
  path: string;              // repo path, e.g. "content/blog/wip/hello-world.mdx"
  sha: string;               // blob sha
  frontmatter: Record<string, unknown>;   // parsed, for list display + sort
}
```

implementation: one `GET git/trees/{main}?recursive=1` filtered to `dir/*.{mdx,yaml,yml}` and `dir/wip/*` (readmes excluded), frontmatter hydrated from `cms:fm:<blobSha>` or fetched blobs on miss. served from `cms:list:<type>` when fresh. on github failure with a cached list: serve it with `"stale": true` alongside `data` (same serve-stale philosophy as `getCachedData`); with no cache: `502 github_unavailable`.

**`GET /api/admin/content/[type]/[slug]`** — read one entry (works for wip and published; singletons use their fixed slug, e.g. `GET /api/admin/content/bio/bio`).
response `data`: `{ slug, status, path, sha, frontmatter, body, raw }`. `404 not_found` if missing; `502` if github down (no stale fallback here — editing stale content is how conflicts happen).

**`POST /api/admin/content/[type]`** — create. body:

```ts
{ slug: string, frontmatter: Record<string, unknown>, body: string, wip: boolean }  // wip=true default for blog/library/photos
```

validates slug regex + registry `validate()`; PUT without sha; github 422 → `409 exists`. response `201 data: { path, sha, commitSha, commitUrl }`.

**`PUT /api/admin/content/[type]/[slug]`** — update in place. body: `{ frontmatter, body, baseSha: string }`. server serializes and PUTs with `sha: baseSha`. github 409 → response `409 conflict` with `details: { remoteSha, remoteFrontmatter, remoteBody }` (server re-fetches the current file so the ui can offer reload/overwrite). response `data: { sha, commitSha, commitUrl }`.

**`POST /api/admin/content/[type]/[slug]/move`** — publish/unpublish. body: `{ direction: "publish" | "unpublish", baseSha: string }`. single-commit git-data-api move between `dir/` and `dir/wip/`. `400 validation` if the type has no wip convention; `409 conflict` if `baseSha` no longer matches or the ref moved mid-sequence (after one internal retry). response `data: { path, commitSha, commitUrl }`.

**`DELETE /api/admin/content/[type]/[slug]?sha=<blobSha>`** — delete. `409 conflict` on sha mismatch. response `data: { commitSha, commitUrl }`.

### leetcode

**`GET /api/admin/leetcode/lookup?url=<leetcode url>`** — server-side autofill proxy (browser can't call leetcode directly: cors). gates, in order (each → failure envelope, per `docs/research/leetcode-graphql.md`):
1. url must match `https://leetcode.com/problems/([a-z0-9-]+)(/.*)?` (strips `/description/`, `/solutions/`; leetcode.cn rejected) → else `400 validation`.
2. redis `lc:q:<slug>` hit → return cached.
3. `POST https://leetcode.com/graphql` with exactly `{"query":"query q($slug: String!) { question(titleSlug: $slug) { questionFrontendId title titleSlug difficulty isPaidOnly } }","variables":{"slug":…}}`, `AbortSignal.timeout(8000)`.
4. `!res.ok` or content-type not `application/json` → `502 { code: "lookup_failed", message: "leetcode lookup unavailable — fill fields manually" }` (429 upstream → one retry after 1 s, then `429 rate_limited`).
5. `question === null` → `404 not_found` ("problem not found — check the url").
6. schema gate: `questionFrontendId` numeric string, non-empty `title`, `difficulty ∈ {Easy,Medium,Hard}` → else `502 lookup_failed` (schema drift treated as outage). success → cache 30 d, return `data: { number: number, title: string, difficulty: "Easy"|"Medium"|"Hard" }`.

**`POST /api/admin/leetcode`** — commit a solution. body:

```ts
{ number: number, title: string, difficulty: "Easy"|"Medium"|"Hard",
  language: string, code: string, path?: string }   // path defaults from the convention in §data-model c
```

validation: number ≥ 1, non-empty title/code, difficulty enum, path has no `..` and doesn't start with `/`. commit message built as `` `${number}. ${title} (${difficulty})` `` and **asserted against `parseCommitMessage`'s regex before committing** (belt-and-suspenders so a weird title can't silently produce an unparseable commit). PUT to `andrewyzhou/leetcode`; if the path exists (422), retry once with `-2` suffix before the extension, else `409 exists` with the conflicting path in details. on success, best-effort refresh of the public store: import and run the same sync used by `src/app/api/github/leetcode/route.ts` (extract its `syncSubmissions` into `src/lib/leetcode-sync.ts` so both call sites share it); failure to sync is logged, not surfaced (the GET route self-heals via latest-sha detection). response `201 data: { commitSha, commitUrl, path, synced: boolean }`.

### calendar + deploy

**`GET /api/admin/calendar?from=2026-02&to=2026-07`** — merged events for an inclusive month range (max 12 months per request). response `data: AdminCalendarPayload` (§data-model f). each source fetched independently with `Promise.allSettled`; a rejected source logs `log.warn("admin:calendar", "source <name> failed", err)` and sets `sources[name]="error"` while others return. sources: neon activities (WS2 repository, e.g. `listActivities({from,to})` in `src/lib/activities.ts` — adapt to WS2's actual export), redis `leetcode_submissions` store (read-only, same key as the existing route), `getContributions("andrewyzhou")` from `src/lib/github.ts` (commit counts per day), and the content listing (reuses the `GET /api/admin/content/[type]` internals for blog/library/photos).

**`GET /api/admin/deploy-status?sha=<commitSha>`** — vercel build feedback without a vercel token: `GET /repos/andrewyzhou/personal-site/deployments?sha=<sha>` then `GET …/deployments/{id}/statuses` (vercel's github integration writes these). response `data: { state: "unknown"|"pending"|"in_progress"|"success"|"failure"|"error", targetUrl: string|null }`. memoized in `cms:deploy:<sha>` for 10 s. any github failure → `data: { state: "unknown", targetUrl: null }` (200 — this endpoint never errors; the ui degrades to the optimistic note + commit link).

### image upload (reused from WS2)

new-content images use the WS2 blob client-upload route (assumed `POST /api/admin/upload`, `@vercel/blob/client` `handleUpload` with session check in `onBeforeGenerateToken`). WS3 only adds a pathname convention: `content/<type>/<slug>/<filename>` with `allowedContentTypes: ["image/jpeg","image/webp","image/png"]`. if WS2 shipped a narrower `allowedContentTypes` or pathname allowlist, extend it there rather than adding a second upload route. uploads count toward the 1 GB hobby cliff and are covered by WS2's store-size audit.

## ui/ux (every screen/flow, described concretely against the existing theme; mobile-first where relevant)

all admin ui lives under the WS2 `/admin` layout. visual language: reuse `card-bg`, `link-highlight`, `link-highlight-active`, `calendar-day`, `calendar-day-number`, `calendar-activity` classes and `--theme-*` variables from `src/app/globals.css`; `font-sans`, `text-off-white` / `text-gray` text classes; **all text lowercase**; icons follow the existing 14–18 px svg pattern, and any new inline svg uses `stroke="#EEEEEE"` (never `currentColor`). new css goes only in `src/app/admin/admin.css` (scoped under `.admin-cms`), which is additive — no edits to existing component styles.

**1. "+" menu (global in admin header).** a `+` button (right side of the WS2 admin nav, 44 px tap target). tap opens a `card-bg rounded-lg` popover (bottom-sheet on <768 px) listing, one `link-highlight` row each with its icon: `blog post → /admin/content/blog/new`, `library entry → /admin/content/library/new`, `photo essay → /admin/content/photos/new`, `activity → /admin/activities/new` (deep link to the WS2 .fit uploader — adapt to WS2's actual route), `leetcode solution → /admin/leetcode/new`, and a secondary group `work / research / teaching / projects item`. esc/tap-outside closes.

**2. browse — `/admin/content` and `/admin/content/[type]`.** `/admin/content` shows the type tabs (same chip pattern as the public filter chips: `link-highlight` / `link-highlight-active`), defaulting to blog; singletons appear as a fixed group at the bottom ("site: bio · sections · coursework · hero quotes") linking straight to their editors. per-type list: a search input (plain themed `<input>`, `card-bg`, filters client-side over slug/title/tags), a sort toggle (`newest / a–z`, library also `status`), and rows rendered like the public `PostRow` pattern — title (`text-off-white`), meta line (`text-gray text-sm`: date · tags · status). wip entries get a `wip` chip (`link-highlight` pill). row tap → editor. row overflow menu (⋯): `publish`/`unpublish` (types with wip), `delete`, `view on site` (published only), `view on github`. stale list (github down, cache served) shows a quiet `text-gray text-xs` note: "github unreachable — showing cached list". mobile: rows are full-width, single column; search and sort stack.

**3. editor — `/admin/content/[type]/new` and `/admin/content/[type]/[slug]`.** one screen, three zones, stacked on mobile:

- *frontmatter form* (top): per-type controlled fields.
  - blog: title (text; on create, auto-derives the slug field live, kebab-cased, editable until first save, locked after), date (native `<input type=date>`, default today), summary (textarea), tags (`TagInput` chip field, enter/comma to add), cover (`ImageField`: shows current image thumb, "upload" → downscale + blob upload → url, or paste a path), pinned (checkbox).
  - library: title, creator, type (`<select>` of the 5 `LibraryType`s), source url, date started, date completed (helper text: "setting this marks the entry completed"), rating (number input, step 0.5), tags, summary.
  - photos (v1 form): title, date, caption, photo list — ordered rows with filename, drag-handle reorder, remove; "add photos" uploads via downscale→blob for new essays or accepts typed filenames for legacy `public/photos` sets; cover picker = tap a row to mark as cover. (block-format editing lands in WS6; if a file has `format: blocks` the form shows "this essay uses the block format — edit raw yaml" and falls back to a raw yaml textarea with validation on save.)
  - experience items: order (number), title, company, company url, location, period, year.
  - all validation errors render inline under the field (`text-gray text-sm`, prefixed "⚠"), and the save button stays enabled — server re-validates.
- *body editor* (middle): `MdxEditorField` (mdxeditor, see below). yaml singletons/photos have no body zone.
- *action bar* (bottom, sticky on mobile): `save` (primary: commits via POST/PUT; label shows "save draft" when the file is in wip), `publish`/`unpublish`, `preview` toggle, `delete` (danger, right-aligned; opens `ConfirmDialog`: "delete <title>? this commits a deletion to github." confirm/cancel), and the `DeployStatus` chip after a commit.

mdxeditor integration (`src/components/admin/MdxEditorField.tsx`, `"use client"`, loaded with `next/dynamic` `ssr: false`): plugins `headingsPlugin, listsPlugin, quotePlugin, thematicBreakPlugin, linkPlugin, linkDialogPlugin, imagePlugin, tablePlugin, codeBlockPlugin, codeMirrorPlugin, markdownShortcutPlugin, jsxPlugin, diffSourcePlugin, toolbarPlugin`. `jsxComponentDescriptors` register `Figure` (props: src, caption, alt, width, height; rendered in-editor as a plain `<img>` + caption) and `Gallery` (flow container) so blog mdx round-trips; anything else falls to `GenericJsxEditor` (bio's `<span className=…>` spans render as generic chips and survive round-trip). `imagePlugin.imageUploadHandler` = downscale (WS2 client util: heic→jpeg/webp, ≤2000 px) → `upload()` from `@vercel/blob/client` to `/api/admin/upload` under `content/<type>/<slug>/` → returns the blob url; on upload failure, toast "image upload failed — nothing inserted" and log to console (client side), never lose editor content. the toolbar is trimmed to: bold/italic, h2/h3, list, quote, link, image, code block, source-mode toggle (diffSourcePlugin's `source` view is the escape hatch for exotic mdx). restyling: import `@mdxeditor/editor/style.css` once in the admin layout, then override in `admin.css` by mapping mdxeditor's css variables to the theme (`--baseBg → var(--theme-bg)`, text → `var(--theme-text)`, accents/borders → `var(--theme-divider)` / `var(--theme-highlight-bg)`, popover/dialog backgrounds → `var(--theme-bg)` + `card-bg` tones), font-family to the site's sans stack, all toolbar labels lowercase via `text-transform: lowercase`.

*"how it renders" preview*: the `preview` toggle swaps the body zone for `MdxPreview` (`src/components/admin/MdxPreview.tsx`): client-side compile of the current mdx via `@mdx-js/mdx` `evaluate()` (500 ms debounce) rendered with a **client-safe mirror of the real component maps** — the typography map from `src/components/mdx/components.tsx` plus preview variants of `Figure`/`Gallery` that use plain `<img>` (the real `Figure` in `src/components/blog/mdx.tsx` reads the filesystem and is server-only). the preview container copies the public article constraints (`max-width: 720px`, same `hr`/spacing) so it is a faithful facsimile rather than pixel-identical rsc output — accepted trade-off; the final source of truth is the deployed page, one commit away. compile errors render a quiet `text-gray text-sm` box "preview unavailable: <first error line>" — never block editing or saving.

*conflict + outage handling in the editor*: on `409 conflict`, a `card-bg` banner: "this file changed on github since you opened it" with `reload remote` (replaces form + editor content, keeps a localstorage snapshot of your version) and `overwrite` (re-PUTs with the fresh remote sha). on `502 github_unavailable`: banner "github unreachable — your draft is saved on this device", save button becomes `retry`; the localstorage draft (§data-model e) guarantees nothing is lost.

**4. singleton editors — `/admin/site/[name]`.** bio: mdxeditor only + save. sections: 8 labeled textareas (one per `SectionKey`, helper text "leave empty to hide the blurb"). coursework: semester repeater (name + course repeater: code, title, cheatsheets repeater of label/url; add/remove/reorder buttons per row) with helper text about the trailing-`*` footnote convention. hero quotes: repeater of multiline textarea + attribution input, reorderable. all built on one generic `ListEditor` repeater component.

**5. leetcode — `/admin/leetcode/new`.** mobile-first single column: url paste field with an `autofill` button (and auto-trigger on paste). during lookup: button shows "looking up…"; on failure the exact error message from the api renders under the field (`text-gray text-sm`) and **the fields below remain empty and editable** — save is never blocked by lookup state. fields: number (number input), title (text), difficulty (three-chip selector easy/medium/hard using `link-highlight(-active)`), language (`<select>` from the extension map), path (auto-computed from number+title+language, editable, monospace), solution code (plain `<textarea>` with `font-mono`, no code-editor dependency). commit-message preview line renders live below the form exactly as it will be committed: `1234. some title (Medium)`. `save` → POST → success shows commit link + "calendar will update shortly"; `409 exists` shows the conflicting path with the suggested suffix already applied to the path field.

**6. admin calendar — `/admin/calendar`.** new client component `src/components/admin/AdminCalendar.tsx` generalizing the view-state machine of `ActivityCalendar` (the `calendar → selector → detail` pattern at `src/components/ActivityCalendar.tsx:500-800`) into four levels:

```ts
type AdminCalView =
  | { level: "grid" }                                    // multi-month
  | { level: "month"; ym: { year: number; month: number } }
  | { level: "day"; date: string }                       // selector
  | { level: "detail"; event: AdminCalendarEvent };
```

- *grid*: responsive grid of mini-months (1 column <480 px, 2 <768 px, 3 desktop; default range = trailing 6 months, "load earlier" prepends 6 more, refetching `/api/admin/calendar` per range). mini-month day cells are 10–12 px squares: empty = `--theme-highlight-bg` at rest; days with events = one dot per distinct kind (max 3, `--theme-text-primary` at graded opacity); image-type days (blog with cover / photo essay) paint the `thumb` as a blurred cover (`background-image` + `filter: blur(2px) brightness(0.6)` on a pseudo-element — plain css, no next/image at this size). month label above each mini-month is a `link-highlight` button → month level.
- *month*: reuses the exact public layout idioms — `DAYS` header row, `grid grid-cols-7 gap-1`, `.calendar-day` cells — but the day cell (`AdminDayCell`) renders up to one icon per event kind present (activity icon from `/icons/activities/<type>.svg` via the same `ACTIVITY_ICONS` map, `E/M/H` letter for leetcode, github mark for commits, and three new 16 px inline svgs for blog/library/photos with `stroke="#EEEEEE"`), cycling every 2 s exactly like `StravaDayCell` when >3 kinds; image-type days get the blurred-thumb background with the icon on top; a count badge like the existing `-top-1 -right-1` bubble when >1 event. back arrow → grid. height/width locking on drill-down copies the `lockedHeight/lockedWidth` `containerRef` trick from `ActivityCalendar` so the card doesn't jump.
- *day (selector)*: the `StravaActivitySelector` pattern — back arrow + lowercase long date header, then one `link-highlight` row per event: icon, primary line (activity name / `123. two sum` / post title / "n commits"), secondary `text-gray text-xs` line (time · kind · status).
- *detail*: per-kind panel in the `StravaActivityDetail` layout (back arrow header, icon tile with `border: 1px solid var(--theme-highlight-bg)`, stat grid where applicable) with kind-specific actions: activity → "open activity →" (`/activities/[id]`); leetcode → "view problem →" / "view solution →" (same links as `LeetCodeProblemDetail`); blog/library/photos → "edit →" (`/admin/content/<type>/<slug>`) + "view on site →" when published; commit → "view on github →".
- degraded sources: when `sources.<name> === "error"`, a single `text-gray text-xs` line under the grid: "some sources unavailable: commits, activities" — the rest render normally.
- the public `ActivityCalendar` is not modified in any way.

**7. deploy feedback (`src/components/admin/DeployStatus.tsx`).** after any successful commit the action bar shows: `committed <7-char sha> — rebuilding (~1–2 min)` with a status dot, polling `/api/admin/deploy-status?sha=` every 10 s for up to 5 min: `pending/in_progress` → pulsing dot (reuses `animate-pulse`), `success` → "live" + link to the page, `failure/error` → "build failed — view on vercel →" (targetUrl), `unknown` after 5 min → stops polling, leaves "committed <sha> →" linking to the commit. purely additive feedback; a polling failure never affects the editor.

## implementation plan (ordered steps, each with the files to create/modify and what goes in them; note which steps are parallelizable)

**step 0 — preflight (owner + agent, 30 min).** create the fine-grained PAT (see dependencies), add `GITHUB_CONTENT_TOKEN` to vercel + `.env.local`. confirm: WS2's session helper name/path, blob upload route path + `onBeforeGenerateToken` constraints, client downscale util path, activities repository export, the default branch and existing file layout of `andrewyzhou/leetcode` (adjust the path default), and vercel's github integration writes deployment statuses (check any recent commit's `/deployments`).

**step 1 — github client + errors (foundation).**
- create `src/lib/admin/github-content.ts`: raw-`fetch` wrapper (no octokit, matching `src/lib/github.ts` style): `getFile(repo, path)`, `putFile(repo, {path, content, message, sha?})`, `deleteFile(repo, {path, message, sha})`, `getTree(repo)`, `moveFile(repo, {fromPath, toPath, blobSha, message})` (git data api sequence with one non-fast-forward retry), `getDeploymentState(repo, sha)`. all calls: `Authorization: Bearer ${process.env.GITHUB_CONTENT_TOKEN}`, `AbortSignal.timeout(10000)`, typed error classes `GitHubConflictError`, `GitHubNotFoundError`, `GitHubExistsError`, `GitHubRateLimitError`, `GitHubUnavailableError`; every failure logged `log.error("github:content", …)`.
- create `src/lib/admin/api-envelope.ts`: `ok(data, status?)` / `fail(code, message, status, details?)` `NextResponse` helpers + error-class→envelope mapping.

**step 2 — registry, serializers, validators (foundation, parallel with 1).**
- create `src/lib/admin/frontmatter.ts` (gray-matter stringify + js-yaml dump with the §data-model options, key-order enforcement, empty-optional omission), `src/lib/admin/content-registry.ts` (the full `CONTENT_TYPES` table), `src/lib/admin/content-schema.ts` (hand-rolled per-type validators in the style of `src/lib/validate.ts` — no zod).

**step 3 — content crud api (needs 1+2).**
- create `src/app/api/admin/content/[type]/route.ts` (GET list, POST create), `src/app/api/admin/content/[type]/[slug]/route.ts` (GET, PUT, DELETE), `src/app/api/admin/content/[type]/[slug]/move/route.ts` (POST). list caching per §data-model d; conflict envelope includes re-fetched remote content.

**step 4 — browse ui (needs 3).**
- create `src/app/admin/content/page.tsx`, `src/app/admin/content/[type]/page.tsx` (server shells) + `src/components/admin/ContentList.tsx` (client: search/sort/rows/overflow actions), `src/components/admin/ConfirmDialog.tsx`, `src/app/admin/admin.css` (import in the admin layout).

**step 5 — editor core (needs 2; ui wiring needs 3).**
- create `src/components/admin/MdxEditorField.tsx` (mdxeditor wrapper: plugins, jsx descriptors, trimmed toolbar, upload handler), mdxeditor theme overrides in `admin.css`, `src/components/admin/FrontmatterForm.tsx` + field primitives `src/components/admin/fields/{TextField,DateField,TextareaField,SelectField,TagInput,ImageField,NumberField,CheckboxField,ListEditor}.tsx`, `src/components/admin/useLocalDraft.ts` (debounced localstorage draft + restore bar), and the editor pages `src/app/admin/content/[type]/new/page.tsx`, `src/app/admin/content/[type]/[slug]/page.tsx` with the action bar + conflict/outage banners.

**step 6 — preview + blob images (needs 5).**
- create `src/components/admin/MdxPreview.tsx` (`@mdx-js/mdx` `evaluate`, debounced, error-quiet) + `src/components/admin/preview-components.tsx` (client-safe typography/Figure/Gallery map mirroring `src/components/mdx/components.tsx` and `src/components/blog/mdx.tsx`).
- modify `src/components/blog/mdx.tsx` (**small additive change only**): `Figure` accepts optional `width`/`height` props and uses `next/image` for `https` sources when both are provided (local-path behavior unchanged). modify `next.config.ts`: add `images.remotePatterns` narrowly scoped to the blob store hostname (if WS2 hasn't already).
- extend the WS2 upload route's pathname/content-type allowlist for `content/<type>/<slug>/` (modify, don't duplicate).

**step 7 — singleton editors (needs 5).**
- create `src/app/admin/site/[name]/page.tsx` + `src/components/admin/singletons/{BioForm,SectionsForm,CourseworkForm,HeroQuotesForm}.tsx` on the step-5 primitives.

**step 8 — "+" menu (needs routes to exist; trivially parallel after 4).**
- create `src/components/admin/NewEntryMenu.tsx`; mount it in the WS2 admin layout header (modify `src/app/admin/layout.tsx`).

**step 9 — leetcode flow (parallel with 3–8; needs only step 1).**
- create `src/lib/admin/leetcode-lookup.ts` (gated graphql fetch + `lc:q:` caching), `src/lib/leetcode-sync.ts` (extract `syncSubmissions` from `src/app/api/github/leetcode/route.ts`; modify that route to import it — behavior unchanged), `src/app/api/admin/leetcode/lookup/route.ts`, `src/app/api/admin/leetcode/route.ts`, `src/app/admin/leetcode/new/page.tsx` + `src/components/admin/LeetCodeForm.tsx`.

**step 10 — admin calendar (needs 3 for content events; other sources parallel).**
- create `src/lib/admin/calendar-events.ts` (per-source fetchers + merge + `sources` health), `src/app/api/admin/calendar/route.ts`, `src/components/admin/AdminCalendar.tsx` (+ `AdminDayCell`, `AdminDaySelector`, `AdminEventDetail` in the same file, mirroring `ActivityCalendar`'s internal-component structure), `src/app/admin/calendar/page.tsx`, three new icon svgs `public/icons/{blog,library,photos}.svg` (`stroke="#EEEEEE"`).

**step 11 — deploy status (parallel with 9/10; needs step 1).**
- create `src/lib/admin/deploy-status.ts`, `src/app/api/admin/deploy-status/route.ts`, `src/components/admin/DeployStatus.tsx`; wire into the editor action bar and leetcode form success states.

**step 12 — docs + env.**
- modify `README.md` roadmap tracker; document `GITHUB_CONTENT_TOKEN` setup/rotation and the cms in `docs/PLAN.md` (mark WS3 items); note comment-loss behavior in the three yaml files' header comments before first cms save (or accept the loss).

parallelization summary: {1, 2} parallel → 3 → {4, 5} → {6, 7, 8}; {9, 11} parallel to everything after 1; 10 after 3. three implementation agents can run as: agent A = 1,3,4; agent B = 2,5,6,7,8; agent C = 9,10,11 (C's step 10 rebases on A's step 3).

## dependencies (exact npm packages with a one-line justification each; env vars to add)

packages to add:

- `@mdxeditor/editor` (^3) — the locked wysiwyg markdown/mdx editor; provides jsx descriptors, image/link dialogs, source-mode toggle.
- `@mdx-js/mdx` (^3) — client-side `evaluate()` for the live "how it renders" preview (already an indirect dep via `@next/mdx`; pinned directly because we import it).
- `@vercel/blob` — client `upload()` for editor image insertion (skip if WS2 already added it).

already present, reused (no version changes): `gray-matter` (frontmatter parse/stringify), `js-yaml` (+`@types/js-yaml`) (yaml singletons/photosets), `@upstash/redis` (caches), `next`/`react` 19, `vitest`.

deliberately **not** added: `octokit` (raw fetch matches `src/lib/github.ts`/`leetcode.ts` style and keeps the bundle small), `zod` (hand-rolled validators match `src/lib/validate.ts`), `react-hook-form` (controlled forms are sufficient at this scale), any leetcode api wrapper (rejected by research), code-editor components for the leetcode textarea.

env vars to add:

- `GITHUB_CONTENT_TOKEN` — fine-grained PAT, resource owner `andrewyzhou`, **repository access limited to exactly `andrewyzhou/personal-site` and `andrewyzhou/leetcode`**, permissions: contents read/write, metadata read (forced), deployments read (personal-site, for deploy status). max expiry (1 yr); set a calendar reminder to rotate; lives only in vercel server env + `.env.local`, never `NEXT_PUBLIC_*`, never sent to the browser. kept separate from the existing read-mostly `GITHUB_TOKEN` so a leak of either has minimal blast radius and rotation is independent.

no new env for auth (WS2's `AUTH_*` + allowlist), blob (`BLOB_READ_WRITE_TOKEN` from WS2), redis (`KV_REST_API_*`), or neon (WS2's `DATABASE_URL`).

## failure modes & observability (what breaks, what the user sees, what gets logged)

| failure | user sees | logged (via `src/lib/log.ts`) |
|---|---|---|
| github api down / 5xx / timeout on read | browse: cached list + "github unreachable — showing cached list"; editor open: error state with retry, no stale editing | `log.error("github:content", "read failed <repo>/<path>", err)` |
| github down on write | banner "github unreachable — your draft is saved on this device", save→retry; localstorage draft persists; **no queue** (decision: single author, queues risk reordered/duplicate commits and silent divergence; a clear error + preserved draft is strictly safer) | `log.error("github:content", "write failed <path>", err)` |
| sha conflict (file changed upstream, e.g. desktop commit or second tab) | 409 banner with reload remote / overwrite choice; nothing lost either way | `log.warn("admin:content", "conflict on <path> base=<sha>")` |
| create collision (slug exists) | inline "an entry with this slug already exists", slug field focused | `log.warn("admin:content", "exists <path>")` |
| github secondary rate limit (80 writes/min — practically unreachable) | "github is rate limiting — wait a minute and retry" | `log.warn("github:content", "rate limited", err)` |
| leetcode graphql: cloudflare block / non-json / 429 / timeout / null question / schema drift | exact per-gate message under the url field; fields stay editable; save unaffected | `log.warn("leetcode:lookup", "<gate> failed for <slug>", err)` |
| leetcode commit ok but redis sync fails | success ui + "calendar will update shortly" (public GET self-heals via sha check) | `log.warn("admin:leetcode", "post-commit sync failed", err)` |
| vercel build fails after commit | deploy chip → "build failed — view on vercel →"; content is committed (git is truth), fix-forward from the editor | nothing server-side (github holds the status); chip state visible |
| deploy status unavailable (permission missing / github down) | chip stays "committed <sha> →" with commit link; no error | `log.warn("admin:deploy", "status fetch failed", err)` |
| calendar source dies (neon, redis, github graphql, content listing) | calendar renders remaining sources + "some sources unavailable: …" | `log.warn("admin:calendar", "source <name> failed", err)` |
| blob upload fails mid-edit | toast "image upload failed — nothing inserted"; editor content intact | client console; server side logged by WS2 upload route |
| redis down entirely | lists/lookups fetch direct from upstreams (slower, still correct — same fall-through as `src/lib/cache.ts`) | `log.error("cache:<key>", …)` existing pattern |
| mdx preview compile error | "preview unavailable: <msg>" box; editing/saving unaffected | none (client-only, expected during typing) |
| bad frontmatter round-trip (file a form can't represent, e.g. blocks-format photoset) | raw-source fallback textarea with validation on save — never a destructive rewrite | `log.warn("admin:content", "raw fallback for <path>")` |

invariants: no admin route ever throws unhandled (every handler wraps in try/catch → `fail("internal", …)` + `log.error`); no write path ever deletes-before-write (moves are single atomic commits; deletes require the current sha); the public site is unaffected by any admin failure (admin routes are isolated under `/api/admin/*` and `/admin/*`).

## testing plan (what gets vitest coverage)

unit tests in `src/lib/admin/__tests__/` and `src/app/api/__tests__/`, following the existing mocked-fetch style of `src/app/api/__tests__/spotify-route.test.ts`:

- **frontmatter round-trip** (`frontmatter.test.ts`): for each content type, `parse(serialize(fm, body))` is identity; loader-compat checks — serialized blog/library files parse correctly through the real `gray-matter` + `toISODate` path (unquoted dates), `year` stays a quoted string, empty optionals omitted, tags `[]` preserved, hero-quote multiline text emits `|-` block literals and survives `js-yaml` round-trip, coursework nested cheatsheets round-trip, sections empty-string values preserved.
- **validators** (`content-schema.test.ts`): required-field failures per type, slug regex accept/reject table (incl. uppercase, dots, leading `-`), difficulty/type enums, url shape, `..`/absolute leetcode paths rejected.
- **github-content** (`github-content.test.ts`, mocked `fetch`): base64 encode/decode correctness; PUT-with-stale-sha 409 → `GitHubConflictError`; create-on-existing 422 → `GitHubExistsError`; html "just a moment" body → `GitHubUnavailableError` (content-type gate); rate-limit 403 mapping; `moveFile` issues the exact tree entries (new path with blob sha, old path `sha: null`) and retries once on non-fast-forward then throws; timeout abort path.
- **content routes** (`admin-content-route.test.ts`): auth rejection (no/non-admin session, mocked session helper); list merges published + wip with correct `status`; stale-list serving when github fails with warm cache; PUT conflict envelope carries re-fetched remote content; move rejects types without wip; delete requires sha; commit messages match the conventional strings exactly.
- **leetcode lookup** (`leetcode-lookup.test.ts`): all six research gates — bad/cn url, cloudflare html 403, 429 single-retry, null question, schema drift (bad difficulty / empty title), 8 s timeout — each returns the right envelope and never caches; success caches `lc:q:<slug>`; url normalization strips `/description/` and `/solutions/…`.
- **leetcode commit** (`admin-leetcode-route.test.ts`): built commit message satisfies the real `parseCommitMessage` from `src/lib/leetcode.ts` (import it directly) for normal and hostile titles (parentheses, periods, unicode); path defaulting per language map; exists→`-2` suffix retry; post-commit sync failure doesn't fail the request.
- **calendar merge** (`calendar-events.test.ts`): per-source `allSettled` isolation (one reject → others returned + `sources` flag), day grouping/ordering, library date fallback (`dateCompleted ?? dateStarted`, undated excluded), thumb resolution for local/blob covers, month-range clamping to 12.
- **deploy status** (`deploy-status.test.ts`): state mapping, "no deployment yet" → `unknown`, github failure → `unknown` with 200.
- **draft hook** (`useLocalDraft.test.ts`, jsdom): debounce write, restore-offer only when draft differs, clear-on-commit.

component/e2e testing of mdxeditor itself is out of scope (upstream-tested); the jsx-descriptor round-trip (`Figure`/`Gallery`/generic span) gets one jsdom smoke test serializing editor markdown back out. ci: existing github actions vitest job picks these up unchanged.

## risks & open questions (only questions the owner must answer; make a recommendation for each)

1. **leetcode repo file layout** — the default solution path (`<number>-<kebab-title>.<ext>` at root) was chosen blind; the actual `andrewyzhou/leetcode` layout may differ (folders per topic/language). *recommendation*: before step 9 ships, list the repo once and set the default to match the dominant existing pattern; the editable path field covers exceptions either way. answer needed: confirm layout or bless the proposed default.
2. **yaml comment loss** — first cms save of `sections.yaml`/`coursework.yaml`/`hero-quotes.yaml` drops the header comments (js-yaml discards them). *recommendation*: accept it; the guidance moves into form helper text (step 7) and the git history preserves the old comments. answer needed: ok to lose file comments?
3. **photo essay scope split with WS6** — WS3 ships the v1 form + raw-yaml fallback for `format: blocks`; the block editor, exif extraction, and `src/lib/photos.ts` support for blob-hosted images land in WS6. *recommendation*: confirm this split; if WS6 is far out and you want blob-based simple sets sooner, the v1 form's blob upload path already works — only `photos.ts` would need the v2 `src/width/height` reading moved up into WS3 (one extra day). answer needed: keep the split as designed?
4. **deploy status via github deployments api** — assumes vercel's github integration writes deployment statuses on `andrewyzhou/personal-site` commits (standard behavior, unverified on this repo) and adds `deployments: read` to the PAT. *recommendation*: verify in step 0 (look at any recent commit's deployments via the api); if absent, ship the optimistic note + commit link only — explicitly not a vercel api token, to keep secrets count down. answer needed: none if verification passes; otherwise accept the fallback.
5. **experience-item edits are instantly public** — work/research/teaching/projects have no `wip/` convention, so cms saves publish on next rebuild. *recommendation*: keep as-is (these files change rarely and were always edited live); do not invent a wip convention `src/lib/items.ts` wouldn't respect. answer needed: confirm.
6. **PAT lifetime & blast radius** — fine-grained PAT expires (≤1 yr) and cms writes die silently at expiry; also any server-side compromise can push to `main` of the two repos (though nothing else). *recommendation*: calendar reminder ~2 weeks before expiry; the `github_unavailable` 401-from-github path should log a distinct `log.error("github:content", "auth failed — token expired?")` so the failure is diagnosable in one glance. answer needed: none — flagged so rotation is owned.
7. **mdxeditor fidelity on existing files** — bio's inline jsx and any future exotic mdx (expressions, imports) may render as generic blocks or fail the wysiwyg parse; the source-mode toggle and raw fallback prevent data loss, but heavy jsx authoring stays hand-written. *recommendation*: accept; bio changes are rare and source mode suffices. answer needed: confirm wysiwyg-first with source-mode escape (vs. plain textarea for bio).
8. **rating field semantics** — `rating?: number` in `src/lib/library.ts` has no documented scale; the form ships a bare number input (step 0.5). *recommendation*: confirm the scale (looks like /10 from the `Rating` component usage) and add min/max validation accordingly. answer needed: rating scale.
