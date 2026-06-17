# wip — photo set drafts that aren't published

put `.yaml` set files here while you're still working on them (curating
photos, writing the caption, deciding the cover). anything in this folder is
**invisible to the site**:

- not listed on `/photos`
- not statically generated as a `/photos/[slug]` page
- not returned by `getAllPhotosets`, `getPhotosetBySlug`, or `getAdjacentPhotosets`
- not reachable by url, even with percent-encoded slashes — the loader
  rejects any slug containing `/`, and `path.dirname` is double-checked

to publish a draft: `mv` the yaml up one level into `content/photos/`. on the
next `npm run build` it'll appear on the site. the filename (minus `.yaml`)
becomes the URL slug — `spring-2026.yaml` → `/photos/spring-2026`.

## photo files

the actual jpgs/pngs live in `public/photos/<slug>/`. there's no draft
folder for those — just keep them in their set's public/photos directory.
they won't show up anywhere until a published yaml lists them.

## filename / slug rules

same as library and blog. lowercase ascii, hyphens/underscores, must match
`/^[a-z0-9][a-z0-9-_]*$/`. files that fail get `console.warn`'d at build
time and skipped.

## yaml schema

minimum required fields:

```yaml
title: a short title
date: 2026-05-15        # iso yyyy-mm-dd, drives sort order
caption: one-line caption shown beneath every photo in the viewer
cover: cover.jpg        # filename inside public/photos/<slug>/
photos:                 # ordered list — viewer plays them in this order
  - cover.jpg
  - 01.jpg
  - 02.jpg
```

per-photo captions aren't supported yet — the caption is for the whole
set. if that changes later, swap the string list for `{ file, caption? }`.

## subdirectories are always skipped

`wip/` is just a convention. the loader skips ALL subdirectories under
`content/photos/`. don't create a parallel draft folder.

## git

wip files are committed and pushed (no `.gitignore`). they just don't render
on the site until you move them out.
