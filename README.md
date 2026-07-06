# andrewzhou.org

my personal website built with next.js, tailwind, and typescript. inspired by the cool sites of carolyn wang and charlie kubal! 'currently' section uses literal, spotify, and strava APIs. responses + strava calendar are cached with upstash for redis.

## roadmap

strava made their api pay-only, so the site is moving to a self-hosted activity
platform plus an admin dashboard. full plan with architecture notes lives in
[docs/PLAN.md](docs/PLAN.md).

- [ ] **ws0 — stabilize**: fix spotify crash, error boundaries, serve-stale caching,
      gate mutation endpoints, vitest + ci, small ui fixes
- [ ] **ws1 — architecture decisions**: data layer (git + postgres + blob), auth,
      maps, fit parsing, editor
- [ ] **ws2 — activity platform** (`replace-strava`): .fit upload + parsing, route
      maps, activity photos, detail pages, strava archive import
- [ ] **ws3 — admin cms**: content editing via github commits, new-entry flows,
      leetcode auto-commit, unified activity calendar
- [ ] **ws4 — design system**: shared primitives (cards, headers, chips, carousel,
      maps, date utils), token cleanup
- [ ] **ws5 — engagement**: comments (guest + google sign-in, simple filtering),
      likes, claps, view counters
- [ ] **ws6 — content model**: photo-essay block format with exif/map sidebar,
      detailed coursework tab

## note on usage

this repo is public so you can see how it's built, but please don't copy or redistribute the code. i've gotten requests for a generic template for my site that i'm currently working on and will be released publically for free!

you can contact me at andrewzhou [at] berkeley [dot] edu
