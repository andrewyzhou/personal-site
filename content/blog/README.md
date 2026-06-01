# blog — authoring guide

blog posts are `.mdx` files in this folder (`content/blog/`). one file per post;
the filename (minus `.mdx`) is the URL slug. they render on `/blog` (index) and
`/blog/<slug>` (full post), with a recent-posts preview on the home page.

## writing a post

create `content/blog/my-post.mdx`:

```mdx
---
title: a day in the mountains
date: 2026-06-14            # ISO date; newest sorts first
summary: one-sentence hook shown on the index + home preview.
tags: [travel, photos]
cover: /blog/my-post/cover.jpg   # optional hero image at the top
---

write plain markdown here — headings, **bold**, _italics_, lists, > quotes,
links, `code`. then drop in photos (below).
```

slug rules (enforced by the loader): lowercase ascii, start with a letter/digit,
then letters/digits/hyphens/underscores. no spaces or dots. a bad filename is
skipped with a `[blog] skipping …` warning at build time.

## drafts (wip)

work on a post in `content/blog/wip/my-post.mdx` — it's committed/pushed to
GitHub but **not** published. move it up to `content/blog/` to publish on the
next build. see `wip/README.md` for the full convention.

## photos

**don't commit raw iPhone `.heic` files** — browsers can't render them and
Next's optimizer can't read them. convert first; everything becomes JPEG.

1. make the post's image folder + a `raw/` staging subfolder:
   ```
   mkdir -p public/blog/my-post/raw
   ```
2. drop your originals (HEIC / PNG / JPG) into `public/blog/my-post/raw/`.
3. convert → web-ready JPEGs (resized to ≤2000px, quality 80):
   ```
   npm run images -- public/blog/my-post/raw public/blog/my-post
   ```
   this writes `photo.jpg` etc. into `public/blog/my-post/`. you do **not** make
   WebP/AVIF — `next/image` generates those automatically from the JPEG.
4. reference them in the post (three options):

   ```mdx
   {/* single captioned photo */}
   <Figure src="/blog/my-post/summit.jpg" caption="top of the ridge at dawn." />

   {/* plain markdown also works — the alt text becomes the caption */}
   ![top of the ridge at dawn.](/blog/my-post/summit.jpg)

   {/* two or three side by side */}
   <Gallery>
     <Figure src="/blog/my-post/a.jpg" caption="left" />
     <Figure src="/blog/my-post/b.jpg" caption="right" />
   </Gallery>
   ```

5. commit. the converted `.jpg`s and the `raw/` folder are tracked; the raw
   `.heic` originals are gitignored (kept locally for re-conversion).

`<Figure>` reads the image's real dimensions at build time, so there's no layout
shift and you never type width/height.
