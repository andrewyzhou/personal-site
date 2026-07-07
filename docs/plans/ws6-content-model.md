# ws6 — content model evolution: photo essays, coursework detail, shared list sort

design doc, 2026-07-06. grounded against the codebase at commit `2b3561f`. locked architecture per `docs/PLAN.md` §6 is assumed and not relitigated here. scope locked 2026-07-06: blog and photos stay **entirely separate**; the block format below is **unique to photos**; blog remains the `@next/mdx` pipeline untouched.

## overview (goals, non-goals)

**goals**

1. replace the flat `photos: []` list in `content/photos/*.yaml` with an ordered **block** format (`image | gallery | text`) that serves three use-cases with one format: pure gallery (label-only captions), road-trip essay (photos + paragraphs interleaved), single showcase photo (big image + exif sidebar). old flat yaml files keep working **unchanged, byte-for-byte identical rendering**.
2. per-image **metadata sidebar**: exif (aperture, shutter, iso, focal length, camera/lens, pixel dimensions) + ~1km-rounded coordinates + a minimap pin (ws2's `MiniMap` primitive, maplibre gl + openfreemap, with a non-map fallback). exif is extracted **once at upload time** (exifr, in the admin browser) and denormalized into the yaml — never re-read at runtime.
3. a new `EssayViewer` that generalizes the existing `PhotosetViewer` model (auto-advance, keyboard nav, segmented progress bar) to blocks. `PhotosetViewer` itself is **not modified** — it stays as the legacy renderer, which is how backward compatibility is guaranteed rather than tested for.
4. storage transition: existing sets stay in `public/photos/` + git; new essays' images go to **vercel blob** via admin client uploads with mandatory client-side heic→jpeg/webp downscale (~2000px longest edge). the format's `src` accepts local paths **and** blob urls.
5. coursework detail (item 13): keep the current 2×2 semester grid in `src/components/Experience.tsx` (lines 243–286) as the default view; add per-course expandable detail (experience writeup, quick review, notes/cheatsheet links) using the same select-row → detail-card interaction as the other tabs (lines 288–368). content source: extended `content/coursework.yaml`.
6. **sort control** as an optional, additive element of the (future ws4) shared list template: coursework gets `by semester / a–z`; the prop api lets other tabs opt in later without redesign or restyling of existing rows.
7. rollout respects the frontend-changes constraint: every visual change to an **existing** component ships one-at-a-time with user verification.

**non-goals**

- no changes to the blog mdx pipeline (`src/lib/blog.ts`, `src/components/blog/mdx.tsx` — the `Figure`/`Gallery` components there are blog-only and stay as-is).
- no view counters / likes / comments on photosets (ws5).
- no admin cms editor screens for essays or coursework (ws3 owns the forms; ws6 defines the file formats and ships the client-side upload/extract helpers ws3 will call).
- no migration of existing `public/photos/` sets to blob, ever — they stay in git per the storage research.
- no bulk css refactors; no touching `PhotosetViewer.tsx`, `ProgressBar.tsx`, `JustifiedLayout.tsx` styling; `ProgressBar` is reused **as-is** (its props already generalize).
- no changes to strava code (dormant behind `STRAVA_API_ENABLED`).
- no swipe gestures in v1 (parity with the current viewer, which is arrow/tap-button driven).

**format decision (item 1): yaml blocks, not mdx.** justification, since the scope asks for it explicitly:

- the viewer is a **stateful client machine** (auto-advance ticker, step index, progress fill, sub-carousels, sidebar) that consumes the whole ordered block list as *data props* — exactly how `PhotosetViewer` consumes `photos: Photo[]` today. mdx produces a compiled server jsx tree; driving a slideshow state machine from it would require either parsing the tree back into data or abandoning the viewer model. yaml → typed objects → props is the straight line.
- backward compatibility: the current format is yaml read by `src/lib/photos.ts`; extending the same loader keeps one code path, one slug/wip convention, one `content/photos/` directory, and old files literally unchanged.
- the ws3 admin cms writes this format from structured forms: serializing a blocks array to yaml (`js-yaml`, already a dependency) is trivial and losslessly round-trippable; mdx round-tripping through mdxeditor is not (component props, whitespace, expression drift).
- hand-editing stays possible: the block yaml is no harder to type than today's `photos:` list (examples below), and `content/photos/wip/README.md` gets updated with the schema.
- structural separation from blog: keeping photos on yaml means the two sections can never accidentally share a pipeline — it enforces the "entirely separate" decision in the file tree, not just in convention.
- text blocks are short plain paragraphs (blank-line separated). no markdown in v1; if inline links are ever needed, add a `markdown: true` flag later without breaking the format.

## data model (exact table/schema DDL or file formats, with types)

**no new postgres tables.** essays and coursework are *authored content*, so git is the system of record (locked decision). the "photo/exif metadata in postgres" line in PLAN.md ws1 refers to ws2 *activity* photos only; essay exif lives denormalized in the yaml, extracted once at upload.

### 1. photo entry yaml — `content/photos/<slug>.yaml`

two variants, discriminated by which key is present. a file with `photos:` is **legacy/flat** (schema unchanged from today, see `PhotosetFrontmatter` in `src/lib/photos.ts`); a file with `blocks:` is an **essay**. if both keys are present the loader uses `blocks` and emits `log.warn("photos", ...)`.

```yaml
# ---- essay variant (new) ----
title: string                 # required
date: 2026-08-02              # required, iso yyyy-mm-dd (Date or string; normalized by toISODate)
caption: string               # optional in essays — index hover label + <meta description> fallback
cover: cover.jpg              # required. string filename (resolved to /photos/<slug>/cover.jpg),
                              #   OR absolute local path "/photos/...", 
                              #   OR object { src: "https://<blob-host>/...", width: 2000, height: 1333 }
                              #   object form is MANDATORY for remote srcs (build can't measure them)
blocks:                       # required, ordered, ≥1 entry
  - type: image               # -- image block --
    src: 01.jpg               # required; same resolution rules as cover (filename | /path | https://blob)
    alt: string               # optional; falls back to caption, then "<slug> photo <n>"
    caption: string           # optional; rendered BELOW the frame (frame shape never changes)
    text: |                   # optional; paragraph(s) below the caption, blank-line separated
      plain text only.
    meta:                     # optional; REQUIRED (width+height at minimum) when src is remote
      width: 4000             # px; for local srcs the loader measures via image-size if omitted
      height: 2667
      takenAt: "2026-08-01T06:12:00-07:00"   # optional iso datetime
      exif:                   # optional; all fields optional; display-ready strings (see photo-meta.ts)
        camera: "fujifilm x-t5"
        lens: "xf 23mm f2"
        iso: 200              # number
        aperture: "f/5.6"     # string, pre-formatted
        shutter: "1/250s"     # string, pre-formatted
        focalLength: "23mm"   # string, pre-formatted
      gps:                    # optional. MUST already be rounded to 2 decimals (~1.1 km) —
        lat: 37.83            # the repo is public; precise coordinates must never enter git.
        lon: -122.50          # rounding happens in extractPhotoMeta at upload time.
  - type: text                # -- text block --
    text: |                   # required; blank-line separated paragraphs, plain text
      the second day we ...
  - type: gallery             # -- gallery block (multi-image sub-carousel) --
    caption: string           # optional; below the frame, shown for every sub-image
    images:                   # required, ≥2 entries; each entry = image-block shape minus type/text
      - { src: 07.jpg, caption: "gas station in gualala", meta: { ... } }
      - { src: 08.jpg }
```

`src` resolution rules (implemented in `src/lib/photos.ts::resolveSrc`):

| yaml value | resolves to | dimensions |
|---|---|---|
| `01.jpg` (bare filename) | `/photos/<slug>/01.jpg` | measured from `public/photos/<slug>/01.jpg` via `image-size` (as `readPhoto` does today); `meta.width/height` overrides if present |
| `/photos/other-set/x.jpg` | as-is | measured from `public<path>` |
| `https://<BLOB_HOSTNAME>/...` | as-is | **must** come from `meta.width/height`; block skipped + `log.warn` otherwise |
| any other `https://` host | **rejected** — block skipped + `log.warn("photos", "disallowed image host …")` | — |

### 2. typescript types — `src/lib/photos.ts` (extended)

```ts
// existing, unchanged: Photo, PhotosetFrontmatter
export interface PhotoExif {
  camera?: string; lens?: string; iso?: number;
  aperture?: string; shutter?: string; focalLength?: string;
}
export interface PhotoGps { lat: number; lon: number } // pre-rounded, 2 decimals
export interface EssayImage extends Photo {            // src, width, height, alt
  caption?: string;
  exif?: PhotoExif;
  gps?: PhotoGps;
  takenAt?: string;
}
export type EssayBlock =
  | { type: "image"; image: EssayImage; text?: string }
  | { type: "gallery"; images: EssayImage[]; caption?: string }
  | { type: "text"; text: string };

export interface Photoset {          // existing fields + two additions
  kind: "flat";                      // NEW discriminant
  photoCount: number;                // NEW = photos.length
  slug: string; title: string; date: string; caption: string;
  cover: Photo; photos: Photo[];
}
export interface PhotoEssay {
  kind: "essay";
  slug: string; title: string; date: string; caption: string;
  cover: Photo;
  blocks: EssayBlock[];
  photoCount: number;                // image blocks + gallery images
}
export type PhotoEntry = Photoset | PhotoEssay;
// signatures widen in place — same names, union return:
// getAllPhotosets(): PhotoEntry[]      getPhotosetBySlug(slug): PhotoEntry | null
// getAdjacentPhotosets(slug): { prev: PhotoEntry | null; next: PhotoEntry | null }
```

### 3. step model — `src/lib/essay-steps.ts` (new, pure)

the viewer flattens blocks into linear **steps** (image block → 1 step; text block → 1 step; gallery of n → n steps). the progress bar keeps **one segment per block** (essay structure stays legible; a 12-photo gallery doesn't produce 12 slivers) with fractional fill inside gallery segments — which maps directly onto the untouched `ProgressBar` props (`total` = block count, `currentIndex` = block index, `currentFill` = 0..1).

```ts
export interface EssayStep {
  blockIndex: number;                 // which progress segment this step belongs to
  subIndex: number; subCount: number; // position within a gallery block (0/1 otherwise)
  kind: "image" | "text";
  image?: EssayImage;                 // kind === "image"
  caption?: string;                   // per-image caption, or the gallery block caption
  text?: string;                      // image-block paragraph text, or text-block body
  durationMs: number;                 // 5000 image (parity with AUTO_ADVANCE_MS), 8000 text
}
export function flattenBlocks(blocks: EssayBlock[]): EssayStep[];
export function progressFill(step: EssayStep, elapsedFrac: number): number;
// gallery: (subIndex + elapsedFrac) / subCount ; else elapsedFrac
export function hasTextContent(blocks: EssayBlock[]): boolean; // drives start-paused default
```

### 4. upload-time metadata — `src/lib/photo-meta.ts` (new, client-safe)

```ts
export interface ExtractedPhotoMeta {
  width: number; height: number;
  exif?: PhotoExif; gps?: PhotoGps; takenAt?: string;
}
export async function extractPhotoMeta(file: File | ArrayBuffer): Promise<ExtractedPhotoMeta | null>;
// exifr.parse on the ORIGINAL file (before downscale strips exif). mapping:
//   camera = `${Make} ${Model}` lowercased/deduped · lens = LensModel lowercased
//   iso = ISO · aperture = `f/${FNumber}` · focalLength = `${FocalLength}mm`
//   shutter: ExposureTime ≥ 1 → `${t}s`; else `1/${Math.round(1 / t)}s`
//   gps = { lat: round2(latitude), lon: round2(longitude) }   // ~1.1 km — privacy boundary is HERE
//   takenAt = DateTimeOriginal?.toISOString()
// returns null (never throws) when exifr fails or finds nothing.
```

the downscale re-encode (canvas → webp) strips all exif from the uploaded binary, so the blob-served file carries **no** gps — only the rounded yaml values are public anywhere.

### 5. blob layout

- pathname: `photos/<slug>/<basename>.webp`, uploaded with `addRandomSuffix: true` (idempotent, never overwrites).
- content: webp (or jpeg for heic sources that fail webp encode), longest edge ≤ 2000px, quality ~0.82, target ~300–500 KB (per storage research; ~2000–3000 photos inside the 1 GB hobby cliff).
- store-size audit is owned by ws2 and covers these uploads automatically (same store).

### 6. coursework — `content/coursework.yaml` (extended, all new fields optional)

```yaml
- name: fall 2025                       # existing
  courses:
    - code: cs 161                      # existing
      title: computer security          # existing ("*" suffix convention unchanged)
      cheatsheets:                      # existing; still rendered inline in the grid
        - { label: mt, url: /docs/cs161_mt_cheatsheet.pdf }
      review: string                    # NEW optional — one/two-sentence quick take
      experience: |                     # NEW optional — paragraphs, blank-line separated, plain text
        took this alongside 170 ...
      links:                            # NEW optional — detail-only links (notes, course site, …)
        - { label: notes, url: "https://github.com/andrewyzhou/notes/..." }
```

```ts
// src/lib/content.ts — Course extended in place
export interface Course {
  code: string; title: string;
  cheatsheets?: Cheatsheet[];
  review?: string; experience?: string; links?: Cheatsheet[];
}
export function courseHasDetail(c: Course): boolean; // !!(review || experience || links?.length)
export function semesterShortLabel(name: string): string;
// "fall 2025" → "fa25" · "spring 2026" → "sp26" · "summer 2025" → "su25"
// "high school concurrent enrollment" → "hs" · unknown → name unchanged
```

**why extend the yaml instead of per-course mdx files:** (a) writeups are short by design ("my experience … a quick review … links" per `sections.yaml`); (b) one file = one trivial ws3 cms form per course, no file-creation/orphan churn, no join between `coursework.yaml` ordering and 30+ mdx files; (c) `Experience.tsx` receives `semesters` as plain data props today — plain strings render as paragraphs with zero mdx-compilation plumbing; (d) anything long-form belongs in a blog post and gets a `links` entry. trade-off accepted: no rich formatting in writeups.

### 7. sort control contract — `src/components/SortControl.tsx` (new)

```ts
export interface SortOption { id: string; label: string }   // label lowercase
export interface SortControlProps {
  options: SortOption[];              // renders nothing if length < 2
  activeId: string;
  onChange: (id: string) => void;
}
```

this is the shape the future ws4 shared list template accepts as an **optional** `sort?: SortControlProps` prop — absent means nothing renders, so adopting tabs later is purely additive. ws6 uses it only in the coursework branch of `Experience.tsx`.

## api surface (every route: method, path, auth, request/response shapes, failure envelopes)

ws6 is almost entirely build-time content + client components. **no new public api routes.** the full surface:

### `POST /api/admin/upload` — vercel blob client-upload token handler (shared with ws2; create here only if ws2 hasn't landed it yet — check `src/app/api/admin/` first)

- **auth**: auth.js session where `session.user.email === "andrew06zhou@gmail.com"` (allowlist), enforced inside `onBeforeGenerateToken`. transition fallback while ws2 auth is in flight: `x-admin-secret` header checked via `isAdminRequest` from `src/lib/admin-auth.ts` (the ws0 stopgap, fails closed when `ADMIN_API_SECRET` unset). remove the fallback when session auth ships.
- **request**: `HandleUploadBody` from `@vercel/blob/client` (the sdk's `upload()` token-exchange protocol; the browser posts `{ type: "blob.generate-client-token", payload: { pathname, ... } }`).
- **server config** (inside `handleUpload`): `allowedContentTypes: ["image/webp","image/jpeg","image/png"]` (never heic — conversion is mandatory client-side), `maximumSizeInBytes: 5 * 1024 * 1024` (generous cap; post-downscale files are ~0.5 MB), `addRandomSuffix: true`, pathname must match `^photos/[a-z0-9][a-z0-9-_]*/`.
- **response 200**: the sdk's token json (opaque to us; the browser `upload()` call resolves to `{ url, pathname, contentType, ... }`).
- **failures** (all logged via `log.error("photos:upload", ...)`):
  - `401 { "error": "unauthorized" }` — no session / not allowlisted / bad secret (reuse `unauthorizedResponse()`).
  - `400 { "error": "invalid upload request" }` — bad pathname prefix, disallowed content type, malformed body.
  - `500 { "error": "blob upload failed" }` — `handleUpload` threw (blob store down, token error).
- `onUploadCompleted` is a no-op for essays (the url + meta land in the yaml the admin commits via ws3; nothing to persist server-side). log `log.info("photos:upload", "completed <pathname>")`.

### consumed contracts (owned elsewhere, restated so the implementer doesn't re-derive)

- **ws3 `POST /api/admin/content/commit`** (github contents api commit): ws6 requires it to accept `path: "content/photos/<slug>.yaml"` and `path: "content/coursework.yaml"` with message conventions `photos: add essay <slug>` / `content: update coursework`. publish latency ~1–2 min rebuild, accepted.
- **ws2 `<MiniMap>`** (`src/components/map/MiniMap.tsx`): props assumed `{ lat: number; lon: number; zoom?: number; height?: number; interactive?: boolean }`, renders maplibre gl + openfreemap with its own svg/static fallback. ws6 lazy-imports it and ships a coordinates-text + openstreetmap-link fallback if the module is absent (non-blocking dependency).

### page routes (behavior changes, not new routes)

- `GET /photos` — index now lists flat sets **and** essays merged newest-first (union return of `getAllPhotosets`).
- `GET /photos/[slug]` — dispatches on `entry.kind`: `"flat"` → `PhotosetViewer` (unchanged), `"essay"` → `EssayViewer`. `generateMetadata` description falls back to the first text block's first sentence when `caption` is empty.

## ui/ux (every screen/flow, described concretely against the existing theme; mobile-first where relevant)

house rules applied throughout: lowercase text everywhere; `font-sans`; colors only via existing utility classes (`text-off-white`, `text-secondary`, `text-gray`) and css vars (`--theme-*`); interactive text uses `.link-highlight` / `.link-highlight-active`; surfaces use `.card-bg` / `.card-bg-hover`; no new icons (text glyphs only — `‹ › ✕ ← → ↑ ↓`; if an svg icon ever becomes necessary it must use `stroke="#EEEEEE"` per repo convention); no new design language.

### 1. `/photos` index — visually unchanged

`JustifiedLayout` + `PhotosetCover` render essays exactly like flat sets (cover image, hover overlay + title caption). only prop *types* widen. the home-page photos tab preview (`Experience.tsx` `photosItems`) shows `photoCount` with the same "n photos" italic line.

### 2. `/photos/[slug]` — essay viewer (new `EssayViewer`, mirrors `PhotosetViewer`'s layout skeleton)

top-to-bottom, single centered column (same page chrome as today: `← photos` link, `text-4xl` bold lowercase title):

1. **stage** — `relative w-full flex justify-center items-center`, `minHeight: "60vh"`; image steps render `next/image` with `maxHeight: "75vh", width: "auto", objectFit: "contain"` (identical numbers to `PhotosetViewer`), `‹ ›` step buttons reuse the existing `.photoset-nav-btn` class; next step's image preloaded invisibly (same trick as `PhotosetViewer` lines 146–155). **text steps** render on the same fixed-min-height stage: paragraphs centered vertically, `font-sans text-secondary text-lg leading-[1.45]`, `maxWidth: "42rem"`, left-aligned text. the stage is top-anchored with a fixed minimum, so nothing below it can move the frame.
2. **per-step caption area** (below the frame — the constraint lives here): caption `font-sans text-secondary text-base italic text-center`; gallery steps append a counter line `font-sans text-gray text-xs` — `3 / 5`; image-block `text` paragraphs render under the caption, `font-sans text-gray text-base leading-[1.45]`, `maxWidth: "42rem"`, left-aligned. this area grows **downward**; the frame above never reflows.
3. **progress bar** — the existing `ProgressBar` component untouched, `maxWidth: 900px`: one segment per block, gallery segments fill fractionally via `progressFill`.
4. **set caption + date** — same slot and classes as `PhotosetViewer` lines 176–181 (essay `caption` if present, else omitted; date always).
5. **controls row** — `← back to photos` (left) · `info` · `↑ previous set` · `↓ next set` (right group). `info` appears only when the current step is an image with `exif` or `gps`; styled like the other buttons (`font-sans text-base text-off-white link-highlight`), `link-highlight-active` while the sidebar is open.
6. **keyboard hint** — `← → photos · ↑ ↓ sets · space pause · i info · esc back` plus `· paused` state, same `text-xs italic` line.

**playback**: image steps auto-advance at 5000 ms (parity), text steps at 8000 ms; hover pauses (same `hoverRef` pattern); `document.visibilityState` guard kept. essays where `hasTextContent(blocks)` is true **start paused** (reading pace is the user's; space resumes); pure image/gallery essays auto-play like today. keyboard: `←/→` step, `↑/↓` adjacent entry, `esc` back, `space` pause, `i` sidebar toggle. state resets on slug change.

### 3. metadata sidebar — `MetaSidebar` (new)

- **desktop (≥768px)**: overlay panel absolutely positioned inside the stage container — `position: absolute; right: 8px; top: 50%; transform: translateY(-50%); width: 280px; maxHeight: 90%; overflowY: auto; zIndex: 10`, `backgroundColor: "var(--theme-bg)"`, `border: "1px solid var(--theme-divider)"`, `borderRadius: 8, padding: "1rem"`. overlay (not a flex column) so opening it never shifts the frame. header row: `info` (`text-off-white text-sm font-bold`) + `✕` close button (`text-gray link-highlight text-sm`).
- **mobile (<768px)**: bottom sheet — `position: fixed; left: 0; right: 0; bottom: 0; maxHeight: 60vh; overflowY: auto; zIndex: 40`, same bg, `borderTop: "2px solid var(--theme-divider)"`, `padding: "1rem 1.25rem"`, plus a tap-to-close backdrop `position: fixed; inset: 0; background: rgba(16,16,16,0.5); zIndex: 39`. no drag handle, no animation library — a simple conditional render with the existing `animate-content-enter` keyframe is enough. recommendation over a drawer lib: zero deps, on-theme, ~40 lines.
- **content** (rows: label `font-sans text-gray text-xs` left, value `font-sans text-secondary text-sm` right; sections separated by `1px` `var(--theme-divider)` rules; every field optional — absent rows simply don't render):
  - `camera · lens · aperture · shutter · iso · focal · size` (size = `4000 × 2667`)
  - location section: `37.83, -122.50 (approx)` — the `(approx)` suffix is always shown, honest about rounding — then the minimap: `<MiniMap lat lon zoom={11} height={160} interactive={false} />` via `next/dynamic` (`ssr: false`) with a `card-bg` 160px placeholder while loading; beneath it `open in openstreetmap →` (`text-gray text-xs link-highlight`, href `https://www.openstreetmap.org/?mlat=<lat>&mlon=<lon>#map=12/<lat>/<lon>`). if `MiniMap` fails to load or doesn't exist yet, the coordinates + osm link stand alone.
- sidebar state persists across steps; content swaps with the step; auto-hides (state kept) on text steps.

### 4. three use-cases, one format — example files

**pure gallery** — `content/photos/street-scans.yaml` (local files, label-only captions; could equally be written as a legacy flat file — the essay form is used when per-photo labels are wanted):

```yaml
title: street scans
date: 2026-07-15
caption: portra 400 around the mission
cover: 01.jpg
blocks:
  - { type: image, src: 01.jpg, caption: "24th st bart" }
  - { type: image, src: 02.jpg, caption: "dolores at dusk" }
  - { type: image, src: 03.jpg }
  - { type: image, src: 04.jpg, caption: "clarion alley" }
```

**road-trip essay** — `content/photos/pch-days.yaml` (blob images, paragraphs interleaved; `<BLOB>` = the store hostname):

```yaml
title: pch, day by day
date: 2026-08-10
caption: three days down the one
cover: { src: "https://<BLOB>/photos/pch-days/cover-x1.webp", width: 2000, height: 1333 }
blocks:
  - type: text
    text: |
      we left berkeley at 5am with two rolls of film and no plan past big sur.
  - type: image
    src: "https://<BLOB>/photos/pch-days/bixby-k2.webp"
    caption: bixby creek bridge, 7am
    text: |
      the fog burned off exactly as we crossed. worth the alarm.
    meta:
      width: 2000
      height: 1333
      exif: { camera: "fujifilm x-t5", lens: "xf 23mm f2", iso: 160, aperture: "f/8", shutter: "1/500s", focalLength: "23mm" }
      gps: { lat: 36.37, lon: -121.90 }
  - type: gallery
    caption: roadside stops
    images:
      - { src: "https://<BLOB>/photos/pch-days/stop1-a9.webp", caption: "gas in gorda", meta: { width: 2000, height: 1500 } }
      - { src: "https://<BLOB>/photos/pch-days/stop2-b3.webp", meta: { width: 1500, height: 2000 } }
      - { src: "https://<BLOB>/photos/pch-days/stop3-c7.webp", meta: { width: 2000, height: 1333 } }
  - type: text
    text: |
      day two was all elephant seals and no cell service. recommended.
```

**single showcase** — `content/photos/golden-gate-6am.yaml` (one big image + full exif sidebar):

```yaml
title: golden gate, 6am
date: 2026-08-02
cover: { src: "https://<BLOB>/photos/golden-gate-6am/main-q4.webp", width: 2000, height: 1333 }
blocks:
  - type: image
    src: "https://<BLOB>/photos/golden-gate-6am/main-q4.webp"
    caption: fog rolling under the deck, marin headlands
    meta:
      width: 2000
      height: 1333
      takenAt: "2026-08-02T06:04:00-07:00"
      exif: { camera: "fujifilm x-t5", lens: "xf 55-200mm", iso: 125, aperture: "f/8", shutter: "1/60s", focalLength: "90mm" }
      gps: { lat: 37.83, lon: -122.50 }
```

(single-block essays render with no nav buttons and no auto-advance — `total <= 1` short-circuits, same as `PhotosetViewer` today.)

### 5. coursework tab — default (by semester) view

minimal-diff evolution of `Experience.tsx` lines 243–286:

- a **sort row** appears above the grid (additive, nothing existing restyled): `sort:` label (`font-sans text-gray text-sm`) + `by semester` / `a–z` buttons (`text-sm`, active → `text-off-white link-highlight-active`, inactive → `text-gray link-highlight`), `marginBottom: "1rem"`.
- the 2×2 grid renders **exactly as today**, with one change: courses where `courseHasDetail(course)` is true have their `<li>` content wrapped in a `<button>` — `w-full text-left rounded transition-all duration-200 card-bg-hover` (selected: `card-bg`), with `padding: "0.1rem 0.5rem"` and compensating `margin: "-0.1rem -0.5rem"` so at-rest text alignment is pixel-identical to non-clickable rows. courses without detail render the plain `<li>` unchanged. inline cheatsheet links keep working inside the button (stopPropagation on the anchors).
- selecting a course renders a **full-width detail card directly below the grid** (above the `*` footnote), styled identically to the other tabs' detail panel (lines 328–365): `card-bg rounded-lg`, `padding: "1rem", paddingLeft: "1.25rem"`; header left = code (`text-off-white text-lg font-bold`) + course title (`text-secondary text-lg`), header right = semester name (`text-gray text-lg font-semibold`); body = `review` first (`text-secondary text-lg italic`), then `experience` paragraphs (`text-gray text-lg leading-[1.35]`, split on blank lines), then a links row combining `cheatsheets` + `links` as `.link-highlight` anchors. clicking the selected course again collapses the card. on select, `scrollIntoView({ behavior: "smooth", block: "nearest" })`.
- selection key is `` `${semester.name}:${course.code}` `` (cs 197 appears in two semesters — code alone is not unique).
- placement rationale (vs an accordion inside the semester card): the below-grid card reuses the exact detail-card rendering from the other tabs — literally the "same expandable-row interaction": tap row → detail card, which is also precisely how the other tabs behave on mobile (list stacked above detail). the grid cards never change shape, so no grid reflow.

### 6. coursework tab — a–z view

switching the sort to `a–z` swaps the grid for the **existing two-column list/detail layout** (lines 288–368) by mapping courses to `ExperienceItem[]` client-side (exactly how `libraryItems`/`blogItems`/`photosItems` are built at the top of `Experience.tsx`):

- `id` = `` `${semester.name}:${course.code}` ``, `title` = code, `company` = course title, `year` = `semesterShortLabel(semester.name)` (right-aligned slot, short so it never crowds on mobile), `description` = the same review/experience/links jsx as the detail card.
- sorted by `code.localeCompare(code, undefined, { numeric: true })` (so `cs 61a < cs 161`); duplicates (cs 197 ×2) appear as separate rows disambiguated by the semester label.
- courses **without** detail still appear in the list (complete a–z index); their detail panel shows the title + semester and, if any, cheatsheet links — no empty-feeling dead ends.
- the `*` footnote line renders below both views whenever any visible title ends with `*`.
- mobile: identical to the other tabs — list stacks above the detail card (`flex-col md:flex-row`), nothing new to design.
- the chosen sort persists per session only (component state; no url hash — matches how tab selection currently ignores deep state beyond the category hash).

## implementation plan (ordered steps, each with the files to create/modify and what goes in them; note which steps are parallelizable)

commit conventions per repo memory: auto-commit + push after every step; conventional, lowercase, no attribution. **track a (photos) and track c (coursework) are fully parallelizable**; steps inside each track are ordered. every step touching an existing component's rendering ends with a user-verification gate (§ verification protocol below).

**track a — photos data layer (no visual changes; parallel-safe internally)**

- **a1. `src/lib/photos.ts`** — add the types from § data model; `resolveSrc(slug, src)` with host allowlisting (`BLOB_HOSTNAME`); `parseEssay(slug, data)` building `EssayBlock[]` (skip-and-warn invalid blocks; drop galleries left with <1 image); add `kind`/`photoCount` to both variants; discriminate on `blocks` vs `photos` key; wrap the per-file body of `getAllPhotosets` in try/catch so one corrupt yaml or missing image file skips that entry with `log.warn("photos", ...)` instead of killing the build (today `readPhoto`'s `fs.readFileSync` throws build-fatally — fix while in here); same hardening in `getPhotosetBySlug`. legacy output shape must be unchanged (a2 pins it).
- **a2. `src/lib/__tests__/photos.test.ts`** — fixtures + coverage per § testing plan; written alongside a1.
- **a3. `src/lib/essay-steps.ts` + `src/lib/__tests__/essay-steps.test.ts`** — `flattenBlocks`, `progressFill`, `hasTextContent`. parallel with a1.
- **a4. `src/lib/photo-meta.ts` + `src/lib/__tests__/photo-meta.test.ts`** — `extractPhotoMeta` + exported pure formatters (`formatShutter`, `formatAperture`, `formatFocal`, `round2`). parallel with a1/a3.
- **a5. `src/lib/image-client.ts`** — client downscale: heic detect (extension/mime) → `heic-to` decode → canvas draw at ≤2000px longest edge → `toBlob("image/webp", 0.82)` (jpeg fallback) → returns `{ blob, width, height }`. **skip if ws2 already shipped an equivalent — check `src/lib/` first.** parallel.

**track b — photos ui (after a1/a3)**

- **b1. `src/components/photos/EssayViewer.tsx`** — client component per § ui/ux #2: props `{ slug, title, date, caption, blocks, prevSlug, nextSlug }`; step state machine on `flattenBlocks` output (mirror `PhotosetViewer`'s ticker/keyboard/reset structure, lines 40–114); reuses `ProgressBar` and `.photoset-nav-btn` untouched; `i` key + `info` button; image `onError` → placeholder frame (`card-bg rounded` box at the image's aspect ratio, centered `image unavailable` in `text-gray text-sm italic`).
- **b2. `src/components/photos/MetaSidebar.tsx`** — per § ui/ux #3; `next/dynamic` import of ws2 `MiniMap` guarded so its absence degrades to coordinates + osm link.
- **b3. `src/app/photos/[slug]/page.tsx`** — dispatch: `entry.kind === "essay" ? <EssayViewer …/> : <PhotosetViewer …/>` (`PhotosetViewer` call site byte-identical); `generateMetadata` description fallback to first text block. **verify gate 1**: an existing legacy set page is pixel-identical.
- **b4. `src/app/photos/page.tsx` + `src/components/photos/JustifiedLayout.tsx` + `PhotosetCover.tsx` + `src/app/page.tsx`** — type-only widening: `JustifiedLayout`/`PhotosetCover` props narrow to `{ slug, title, cover }` summary shape; home `photosPreview` count switches `s.photos.length` → `s.photoCount` (line 75 of `src/app/page.tsx`). **verify gate 2**: `/photos` index and home photos tab pixel-identical.
- **b5. `next.config.ts`** — `images: { remotePatterns: [{ protocol: "https", hostname: process.env.BLOB_HOSTNAME ?? "*.public.blob.vercel-storage.com" }] }`; pin the exact store hostname once the store exists.
- **b6. seed + docs** — publish one real hand-authored essay (local images fine — format supports it) to `content/photos/`; rewrite the schema section of `content/photos/wip/README.md` for both variants. **verify gate 3**: essay viewer ux review (stage, captions, text steps, gallery counter, progress fill, keyboard, start-paused rule). **verify gate 4** (after b2): sidebar desktop + mobile sheet, minimap or fallback.
- **b7. `src/app/api/admin/upload/route.ts`** — only if ws2 hasn't created it; `handleUpload` per § api surface, auth via session-or-`isAdminRequest` fallback. parallel with b1–b6.

**track c — coursework (parallel with a/b)**

- **c1. `src/lib/content.ts`** — extend `Course`; add `courseHasDetail`, `semesterShortLabel`; **`content/coursework.yaml`** — add `review`/`experience`/`links` to 3–5 real courses (owner supplies text; placeholder-free). **`src/lib/__tests__/content.test.ts`** — new.
- **c2. `src/components/SortControl.tsx`** — per § data model #7. new file, no gate needed until used.
- **c3. `src/components/Experience.tsx` — split into two user-verified commits:**
  - **c3a**: coursework state (`courseworkSort: "semester" | "az"`, `selectedCourseId: string | null`, both reset on category change); `SortControl` row; a–z branch reusing the existing list/detail jsx via a `courseworkItems: ExperienceItem[]` mapping; grid untouched. **verify gate 5**: default view identical but for the sort row; a–z view correct on desktop + mobile.
  - **c3b**: grid `<li>` → conditional `<button>` with the negative-margin hover treatment; below-grid detail card; collapse-on-reclick; scrollIntoView. **verify gate 6**: grid at rest pixel-identical; interaction review.

**verification protocol (constraint from PLAN.md ws0/ws4):** gates 1–6 above each ship as exactly one commit, deployed (or `npm run dev` screenshared), and explicitly approved by the owner before the next visual step starts. gates 1, 2, and the at-rest half of 6 have an objective bar: *pixel-identical*. new-ui gates (3, 4, 5, interaction half of 6) are subjective review. if a gate fails, fix forward within that step — never batch fixes into the next step. non-visual steps (a1–a5, b5, b7, c1, c2) need no gate and may land freely.

## dependencies (exact npm packages with a one-line justification each; env vars to add)

**npm (new)**

- `exifr` `^7.1.3` — battle-tested, zero-dependency exif/gps parser that runs in the browser on `File` objects; used once at upload time in `photo-meta.ts`.
- `heic-to` `^1.1.0` — maintained wasm libheif wrapper for client-side heic→canvas decode (mandatory per the storage decision; vercel image optimization won't process heic). only needed by `image-client.ts`; skip if ws2 already added an equivalent.
- `@vercel/blob` `^0.27.0` — client `upload()` + server `handleUpload` for the client-upload token flow that bypasses the 4.5 MB function body cap. only if ws2 hasn't added it.
- `maplibre-gl` — **not added by ws6**; arrives with ws2's `MiniMap`. listed so nobody double-adds it.

already present and reused: `js-yaml`, `image-size`, `gray-matter`, `next/image`, `vitest`.

**env vars**

- `BLOB_HOSTNAME` — exact public hostname of the blob store (e.g. `abc123xyz.public.blob.vercel-storage.com`); consumed by `next.config.ts` `remotePatterns` and by `resolveSrc` host allowlisting. until the store exists, the wildcard default applies and the loader falls back to suffix-matching `.public.blob.vercel-storage.com`.
- `BLOB_READ_WRITE_TOKEN` — standard vercel blob token for the upload route (auto-injected on vercel; needed in `.env.local` for dev). owned by ws2 if it lands first.
- `ADMIN_API_SECRET` — already exists (ws0); reused as the transition auth fallback on the upload route.

## failure modes & observability (what breaks, what the user sees, what gets logged)

| failure | user sees | logged |
|---|---|---|
| corrupt/invalid essay yaml (bad block type, missing src, gallery <1 image) | that block (or file) silently absent; rest of the site builds and renders | build-time `log.warn("photos", "skipping block/file <detail>")` — visible in vercel build logs as structured json |
| remote image without `meta.width/height` | block skipped | `log.warn("photos", "remote src missing dimensions <src>")` |
| `src` on a non-allowlisted host | block skipped (prevents accidental hotlinking + open remotePatterns) | `log.warn("photos", "disallowed image host <src>")` |
| local image file missing from `public/photos/` | entry skipped, build **survives** (new per-file try/catch — today this kills the build) | `log.warn("photos", "unreadable image <path>")` |
| blob store down / url 404 at runtime | `next/image` fails → `EssayViewer` `onError` swaps in an aspect-ratio-preserving `card-bg` placeholder reading `image unavailable`; captions/text/nav keep working; site never crashes | client-side only (quiet degrade; no client log channel exists) |
| blob hobby 1 GB cliff (30-day cutoff) | as above, for every blob image — legacy git-hosted sets unaffected | prevented upstream by ws2's store-size audit; upload route also logs pathname+size per upload for manual audit |
| maplibre/openfreemap dead, webgl absent, or ws2 `MiniMap` not yet shipped | sidebar shows coordinates text + `open in openstreetmap →` link; no blank pane | `MiniMap`'s own fallback logging (ws2); dynamic-import failure caught silently in `MetaSidebar` |
| exifr finds nothing / throws at upload | admin form shows "no exif found — you can fill fields manually"; publish never blocked | admin console warn (client) |
| upload route auth failure / blob error | admin sees the `{ error }` message inline in the ws3 form | `log.error("photos:upload", …)` |
| coursework yaml missing new fields | grid renders exactly as today; course simply isn't clickable; a–z view still lists it | nothing — valid state |
| malformed coursework yaml | coursework tab shows an empty grid (loadYaml throws → caught in `getCoursework` wrapper added in c1, returns `[]`) | `log.warn("content", "coursework.yaml failed to parse")` |
| github/vercel rebuild pipeline down after a cms commit | old content keeps serving (static, git = SoR) — degraded to stale, never broken | vercel deploy logs (out of ws6 scope) |

structured logging uses the existing `src/lib/log.ts` (`{level, source, message, error}` json lines) with sources `photos`, `photos:upload`, `content`. new loader code paths use `log.warn`, not bare `console.warn`; the two existing `console.warn` calls in `photos.ts`/`blog.ts` are left alone (no-refactor rule).

## testing plan (what gets vitest coverage)

all in `src/lib/__tests__/` (existing harness: vitest + `vi.mock`, ci already runs `npm run test` per ws0). yaml fixtures live under `src/lib/__tests__/fixtures/photos/` and are loaded through the real parser functions (exported for testability), with `fs`/`image-size` mocked where files are synthetic.

- **`photos.test.ts`** — the big one:
  - legacy flat yaml → output deep-equals the pre-ws6 shape plus `kind: "flat"`/`photoCount` (regression pin for backward compatibility).
  - each of the three example files from § ui/ux parses to the expected `PhotoEssay` (blocks, resolved srcs, photoCount = image blocks + gallery images).
  - `resolveSrc`: bare filename → `/photos/<slug>/…`; absolute local passthrough; allowlisted blob url passthrough; foreign https host rejected.
  - remote src without meta dims → block skipped + warn; local src without meta → measured via (mocked) `image-size`; meta overrides measurement.
  - file with both `photos:` and `blocks:` → blocks wins + warn.
  - corrupt yaml / missing local file → that entry skipped, sibling entries still returned (per-file isolation — the build-survival guarantee).
  - `getAdjacentPhotosets` across mixed kinds sorted newest-first.
- **`essay-steps.test.ts`** — `flattenBlocks` on all three fixtures (step counts, blockIndex/subIndex/subCount, durations 5000/8000); `progressFill` for gallery fractional fill (`(sub + frac) / n`) and plain steps; `hasTextContent` true for image-block `text` and text blocks, false for pure galleries.
- **`photo-meta.test.ts`** — pure formatters: `formatShutter(0.004) === "1/250s"`, `formatShutter(2) === "2s"`, `formatShutter(0.5) === "1/2s"`; `formatAperture(5.6) === "f/5.6"`; `round2(37.8267) === 37.83`; exifr output mapping with a recorded fixture object (exifr itself mocked — no binary fixtures in ci); missing-everything → `null`, partial exif → partial `PhotoExif` with absent keys undefined.
- **`content.test.ts`** — extended `Course` parsing (all new fields optional); `courseHasDetail` truth table (review-only, experience-only, links-only, cheatsheets-only → **false**, none → false); `semesterShortLabel` for all six current semester names + unknown passthrough; a–z comparator (`cs 61a` before `cs 161`, numeric-aware); malformed yaml → `[]` + warn.
- **upload route** (`src/app/api/__tests__/upload-route.test.ts`, pattern-matched to the existing `strava-refresh-route.test.ts`): 401 without session/secret (fails closed when `ADMIN_API_SECRET` unset); 400 on bad pathname prefix; happy path delegates to a mocked `handleUpload`.
- explicitly **not** unit-tested: `EssayViewer`/`MetaSidebar` dom behavior (no jsdom component harness exists in this repo; the state machine's logic lives in `essay-steps.ts` precisely so the component stays thin) — covered by verification gates 3–4 instead.

## risks & open questions (only questions the owner must answer; make a recommendation for each)

1. **essays containing text blocks start paused — ok?** implemented default: any essay with text content starts paused (space resumes); pure galleries auto-play like today. **recommend: yes** — auto-advancing past prose you're reading is hostile; the progress bar still communicates position. alternative (reading-time-scaled durations) adds complexity for a worse experience.
2. **slideshow, not scroll, for road-trip essays.** the format is presentation-agnostic data, so a scrollable renderer could be added later with zero format migration — but v1 ships slideshow-only, consistent with the existing viewer and this scope. **recommend: accept slideshow for v1**; revisit only if a real essay exceeds ~20 blocks and feels bad in review (gate 3 will tell).
3. **gps rounding granularity: 2 decimals (~1.1 km).** coarser hides which neighborhood; finer (~110 m at 3dp) approaches "which building". **recommend: keep 2dp globally**, and for genuinely sensitive locations omit `gps` entirely at upload (the admin form gets an "include location" toggle in ws3, default on). the rounding happens client-side before commit because the repo is public — this is non-negotiable in the implementation.
4. **which real courses get writeups at launch?** c1 needs 3–5 courses with actual `review`/`experience` text from you (agents must not invent them). **recommend**: cs 161, cs 170, cs 61c to start — recent, opinionated, and two already have cheatsheet links to showcase the detail card.
5. **courses with only cheatsheets stay non-clickable in the grid** (cheatsheets already render inline; a detail card would add nothing). **recommend: yes** — clickability should promise new content.
6. **detail card below the grid vs accordion inside the semester card.** **recommend: below-grid card** (as designed) — reuses the other tabs' exact detail-card rendering and never reflows the grid; accordion-in-card changes the semester card's shape and needs new styling. if gate 6 review finds the card too far from the clicked course on desktop, fallback option is rendering it directly after that semester's grid row — decide at the gate, not before.
7. **`BLOB_HOSTNAME` pinning**: the exact store hostname doesn't exist until the blob store is created (ws2 ordering). **recommend**: ship with the `*.public.blob.vercel-storage.com` wildcard + suffix allowlist now, pin the literal hostname in `next.config.ts` the day the store exists (one-line follow-up commit).
8. **dependency on ws2's `MiniMap`**: if ws6 lands first, sidebars show coordinates + osm link only. **recommend: do not block** — the fallback is designed in, and swapping `MiniMap` in later is a one-file change to `MetaSidebar.tsx`.
9. **set-level `caption` optional for essays** (showcase example omits it) — legacy files still require it de facto. **recommend: accept optional** for essays; index hover falls back to `title`, meta description falls back to first text block, nothing else consumes it.
