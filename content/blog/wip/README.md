# wip — drafts that aren't published

put `.mdx` posts here while you're still working on them. anything in this
folder is **invisible to the site**:

- not listed on `/blog`
- not statically generated as a `/blog/[slug]` page
- not returned by any loader (`getAllPosts`, `getPostBySlug`, `getAllTags`,
  `getAdjacentPosts`)
- not reachable by url, even with percent-encoded slashes — the loader
  rejects any slug containing `/`, and `path.dirname` is double-checked

to publish a draft: `mv` the file up one level into `content/blog/`. on the
next `npm run build` it'll appear on the site. the filename becomes the URL
slug (e.g. `first-trip.mdx` → `/blog/first-trip`), so the URL stays stable
from draft to published.

to un-publish: `mv` it back into `wip/`. shared `/blog/<slug>` links to the
un-published post will start 404'ing.

## filename / slug rules

the filename (minus `.mdx`) becomes the URL slug. the loader validates it
against `/^[a-z0-9][a-z0-9-_]*$/`:

- lowercase ascii only (no uppercase, no accents, no unicode)
- starts with a letter or digit
- then letters, digits, hyphens, or underscores
- no spaces, no dots, no other punctuation

a filename that fails this gets `[blog] skipping …`-warned at build time and
is silently skipped from the index, so check the build output if a post you
just published isn't showing up.

## frontmatter

```yaml
---
title: your title
date: 2026-05-31      # ISO date; drives sort order (newest first)
summary: one-sentence hook shown on the /blog index and home preview
tags: [tag-1, tag-2]
cover: /blog/your-slug/cover.jpg   # optional hero image
---
```

## subdirectories are always skipped

`wip/` is just a convention. the loader skips ALL subdirectories under
`content/blog/` — `drafts/`, `_drafts/`, `archive/`, anything. don't create a
parallel draft folder; everything goes in `wip/` so there's one obvious place
to look.

## git

wip files are committed and pushed (no `.gitignore`). they just don't render
on the site until you move them out.
