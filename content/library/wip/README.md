# wip — drafts that aren't published

put `.mdx` entries here while you're still working on them. anything in this
folder is **invisible to the site**:

- not listed on `/library`
- not statically generated as a `/library/[slug]` page
- not returned by any loader (`getAllEntries`, `getEntryBySlug`, `getAllTags`,
  `getAdjacentEntries`)
- not reachable by url, even with percent-encoded slashes — the loader
  rejects any slug containing `/`, and `path.dirname` is double-checked

to publish a draft: `mv` the file up one level into `content/library/`. on the
next `npm run build` it'll appear on the site. the filename becomes the URL
slug (e.g. `nonviolent-communication.mdx` → `/library/nonviolent-communication`),
so the URL stays stable from draft to published.

to un-publish: `mv` it back into `wip/`. shared `/library/<slug>` links to
the un-published entry will start 404'ing.

## filename / slug rules

the filename (minus `.mdx`) becomes the URL slug. the loader validates it
against `/^[a-z0-9][a-z0-9-_]*$/`:

- lowercase ascii only (no uppercase, no accents, no unicode)
- starts with a letter or digit
- then letters, digits, hyphens, or underscores
- no spaces, no dots, no other punctuation

a filename that fails this gets `console.warn`'d at build time and is
silently skipped from the index, so check the build output if a file you
just published isn't showing up.

## frontmatter

minimum required fields:

```yaml
---
title: your title
creator: author or speaker name
type: book        # one of: book | video | podcast | course | article
tags: [tag-1]     # at least one tag is nice; not enforced
summary: one-sentence hook shown on the /library index card
---
```

optional: `sourceUrl`, `dateStarted` (ISO date), `dateCompleted` (ISO date,
absence = "in progress"), `rating` (1-5).

## subdirectories are always skipped

`wip/` is just a convention. the loader skips ALL subdirectories under
`content/library/` — `drafts/`, `_drafts/`, `archive/`, anything. don't
create a parallel draft folder; everything goes in `wip/` so there's one
obvious place to look.

## scope

this draft mechanism only applies to library entries. single-file content
(`bio.mdx`, `hero-quotes.yaml`, `coursework.yaml`, `sections.yaml`) is
edited in place — use a feature branch for in-progress changes. item content
(`content/work/`, `content/research/`, `content/teaching/`, `content/projects/`)
doesn't currently have a wip mechanism; if you want one, mirror the pattern.

## git

wip files are committed and pushed (no `.gitignore`). they just don't render
on the site until you move them out.
