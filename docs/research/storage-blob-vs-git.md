# research: blob storage vs committing media to the repo (2026-07-06)

question asked: "is blob storage required? what's the point vs our current setup
(photos in public/ committed to the repo)?"

## direct answer: yes — three independent reasons, each sufficient

1. **hard block**: vercel functions cap request bodies at **4.5 MB** (verified,
   current docs, all plans, applies to app-router route handlers → 413
   FUNCTION_PAYLOAD_TOO_LARGE). phone photos are 5–15 MB heic/jpeg — they cannot
   even REACH an api route that would commit them to git. the only ways around:
   lossy client-side compression under 4.5 MB, shipping a github write token to
   the browser (no), or client-upload direct to blob storage (the official
   workaround, built for exactly this).
2. **latency**: photo-in-git = commit → full next.js rebuild + redeploy = **1–5 min
   until visible**, serialized (hobby = 1 concurrent build). blob = **instant**
   (upload → url → metadata row → revalidatePath). activity photos are wanted
   instantly alongside the uploaded workout.
3. **scale**: ~5 photos/week at 10 MB ≈ **2.6 GB/year**. github recommends repos
   < 1 GB (strongly < 5 GB); the public repo's git history keeps every deleted
   photo forever; every vercel build checkout downloads all of it. (also: full-res
   personal photos permanently in a public repo's history is a privacy choice
   worth avoiding.)

**why the current setup works anyway**: today's public/photos library is small,
hand-curated, desktop-committed, and deploys with the site — none of the three
constraints bite. it can stay exactly where it is.

## chosen provider: vercel blob (r2 as documented fallback)
- hobby free allowance: **1 GB-month storage**, 10 GB transfer/mo, client-upload
  flow bypasses the 4.5 MB limit by design (`upload()` in browser +
  `handleUpload` route with `onBeforeGenerateToken` — MUST authenticate there —
  and `onUploadCompleted` to persist urls). no cors, no dns, no keys in browser.
- **the 1 GB cliff is harsh**: exceeding hobby limits cuts off blob access for
  30 days (site-breaking). mandatory mitigations:
  1. client-side downscale/convert at upload: heic → jpeg/webp @ ~2000px,
     ~300–500 KB each. required anyway — vercel image optimization won't process
     heic and non-apple browsers can't display it. at that size 1 GB ≈ 2,000–3,000
     photos + years of .fit files (100 KB–2 MB each).
  2. store-size audit (list() monthly or on upload) alerting well before 1 GB.
- image optimization quota (hobby): 5,000 transformations/mo, billed on cache-miss
  per variant — a few hundred photos ≈ 1–2 k one-time, then cached. fine. sources
  must be jpeg/png/webp/avif (never heic). `images.remotePatterns` must scope the
  blob hostname narrowly.
- **cloudflare r2 fallback** if store approaches ~800 MB or full-res originals are
  wanted: 10 GB free, zero egress forever, $0.015/GB-mo after; costs setup (bucket
  cors + aws4 presigned puts + custom-domain serving via a cloudflare zone; r2.dev
  is dev-only; needs a payment card on file).

## .fit files
100 KB–2 MB — technically fit through an api route, but go to blob too: no rebuild
churn, originals retained next to their activity, one storage story.

## github contents api (for the admin cms, unrelated to photos)
write path for TEXT content (mdx/yaml) is comfortable: ~100 MB effective file cap,
5,000 req/hr + 80 content-writes/min secondary limit — irrelevant at one-person
scale. the cms plan (admin edits → github commit → rebuild) stands for authored
text content; only binaries route around git.

sources: vercel docs (functions/limitations, pricing, blob docs 2026-06),
github docs (repo sizes, contents api, rate limits), next.js 16 image docs.
