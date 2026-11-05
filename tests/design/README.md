# design harness

Renders the site from frozen fixtures and checks it in a real browser. Its
first job is to lock **v1**, the current design, so that the design-system and
multi-design work can move underneath it without changing a pixel.

## what's frozen

| source | fixture | how |
|---|---|---|
| authored content (`content/`) | `fixtures/content/` | `CONTENT_ROOT` env (read by `src/lib/content-root.ts` and the `@content` alias in `next.config.ts`) |
| client `/api/*` calls | `fixtures/api/*.json` | intercepted in the browser by `support/stage.ts`; unmapped routes answer 404 |
| time | 2026-11-04 14:00 pacific | `page.clock` |
| randomness | seeded `Math.random` | init script |
| external requests | none | images become a 1×1 gray png; everything else is aborted |

The fixture content is a copy of `content/` plus one blog post and two
library entries promoted from `wip/`, so those templates are covered even while
the live sections are empty. Real content edits never touch it, so CMS commits
can't break the lock.

## run it

```sh
npm run build:design     # next build with CONTENT_ROOT=tests/design/fixtures/content
npm run test:design      # starts next on :3100 and compares screenshots
```

Locally it uses your installed Chrome (`channel: "chrome"`), so there's no
browser download. CI uses Playwright's chromium on ubuntu.

## baselines

Screenshots differ slightly by OS (font rasterization), so baselines are kept
per platform under `__screenshots__/<platform>/`. **Only `linux/` is committed.** It's
what CI enforces. The win32 and darwin sets are local dev aids and are
gitignored.

- **First run on a platform:** `npm run test:design -- --update-snapshots=missing`
  writes the baselines.
- **CI:** runs with `--update-snapshots=missing` and uploads every baseline as
  the `design-screenshots` artifact. A missing linux baseline is written and
  uploaded; an existing one is enforced at `maxDiffPixels: 0`.
- **Changing a v1 baseline** is a deliberate act, never a side effect:
  download the artifact, review the images, commit `__screenshots__/linux/`.
  A v1 diff in a design PR means the PR leaked into v1. Fix the PR.
