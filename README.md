# andrewzhou.org

my personal website built with next.js, tailwind, and typescript. inspired by the cool sites of carolyn wang and charlie kubal! 'currently' section uses literal, spotify, and strava APIs. responses + strava calendar are cached with upstash for redis.

## roadmap

strava made their api pay-only, so the site is moving to a self-hosted activity
platform plus an admin dashboard. full plan with architecture notes lives in
[docs/PLAN.md](docs/PLAN.md).

- [x] **ws0 — stabilize**: fix spotify crash, error boundaries, serve-stale caching,
      gate mutation endpoints, vitest + ci, small ui fixes
- [x] **ws1 — architecture decisions**: data layer (git + postgres + vercel blob),
      google auth, maplibre maps, garmin fit ingestion, mdxeditor
- [x] **ws2 — activity platform**: .fit upload + parsing, route maps, activity
      photos, detail pages, 221 activities + 52 archive photos imported from
      the strava archive into neon + r2
- [x] **ws3 — admin cms**: content editing via github commits, mdx editor with
      live preview, new-entry flows, leetcode auto-commit with url autofill,
      unified calendar (big single-month default, multi-month grid, photo +
      route-map thumbnails), deploy status
- [ ] **ws4 — design system**: shared primitives + token cleanup — held for
      step-by-step manual review (visual changes reviewed one at a time)
- [x] **ws5 — engagement**: comments (guest + google sign-in, simple filtering,
      honeypot, rate limits), likes, claps, view counters, admin moderation
- [x] **ws6 — content model**: photo-essay block format with exif/location
      sidebar + minimap, essay builder, detailed coursework tab with sort
      (visual polish pending owner review)

## note on usage

this repo is public so you can see how it's built, but please don't copy or redistribute the code. i've gotten requests for a generic template for my site that i'm currently working on and will be released publically for free!

you can contact me at andrewzhou [at] berkeley [dot] edu
