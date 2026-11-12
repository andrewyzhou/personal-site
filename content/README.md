# content model

This folder, together with the database and a few external APIs, is the
**single source of truth for everything the site says**. Designs (page layouts,
components, styles) render this content; they never own any of it. If a word
appears on the site, it comes from one of the sources below.

## sources

| content | lives in | edited by | read through |
|---|---|---|---|
| site copy: name, footer, nav labels, headings, page intros, link text, empty states, social links | `site.yaml` | hand edit | `getSite()` (`src/content/site.ts`) on the server, `useSite()` (`src/content/SiteProvider.tsx`) in client components |
| bio | `bio.mdx` | cms singleton | `src/components/mdx/Bio.tsx` |
| section blurbs (home tabs) | `sections.yaml` | cms singleton | `getSectionDescriptions()` (`src/lib/content.ts`) |
| hero quotes | `hero-quotes.yaml` | cms singleton | `getHeroQuotes()` |
| coursework | `coursework.yaml` | cms singleton | `getCoursework()`; types in `src/lib/coursework.ts` |
| work / research / teaching / projects | `<category>/*.mdx` | cms | `getItems()` (`src/lib/items.ts`) |
| blog posts | `blog/*.mdx` (drafts stay in the admin) | cms | `src/lib/blog.ts` |
| library entries | `library/*.mdx` (drafts stay in the admin) | cms | `src/lib/library.ts` |
| photo sets and essays | `photos/*.yaml` + images in `public/photos/` or r2 | cms / admin | `src/lib/photos.ts` |
| activities, activity photos | postgres `activities`, `activity_photos` | sync + admin | `src/lib/public-activity.ts`, `/api/activities*` |
| lift workouts | postgres `lift_*` tables | share-text ingest, telegram bot, csv import | `src/lib/lift/public.ts` |
| live "currently" data | spotify, literal, github, leetcode APIs (redis-cached) | — | `/api/spotify`, `/api/literal`, `/api/github`, `/api/github/leetcode` |

## rules

1. **Designs never hardcode copy.** Headings, labels, link text and messages
   come from `site.yaml` or an entry. Glyphs like `←`, `→`, `·`, `↗` are
   design chrome, not content.
2. **Formatting is content.** Dates and units go through `src/content/format.ts`
   (e.g. `formatDay("2026-05-31")` → `may 31, 2026`), so every design shows
   identical strings.
3. **Templates use `{slots}`**, e.g. `this site was last deployed on {date} for
   commit {sha}`. Fill them with `fill()` for a string or `fillParts()` when
   rendering in JSX (`src/content/site-types.ts`).
4. **`site.yaml` is validated** at load time. A missing or misspelled key fails
   the build (`validateSite()`), and the unit tests check it on every run.
5. **Adding a string:** add it to `site.yaml`, its type to `SiteContent`
   (`src/content/site-types.ts`), its key to `REQUIRED_STRINGS`
   (`src/content/site.ts`), and the same key to the design fixture
   (`tests/design/fixtures/content/site.yaml`).

## the design harness

`tests/design/` renders the site from a frozen copy of this folder
(`tests/design/fixtures/content/`, selected with `CONTENT_ROOT`) and compares
screenshots, so editing real content never breaks the design checks. See
`tests/design/README.md`.
