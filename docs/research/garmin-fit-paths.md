# research: getting .fit files out of the garmin ecosystem (2026-07-06)

goal: phone-first workflow — record a workout on the garmin watch, upload the
original .fit (full fidelity: gps, hr, cadence, power, laps) to andrewzhou.org/admin
minutes later.

## the paths, ranked

### 1. manual phone-first (ship first) — garmin connect WEB in the phone browser
connect.garmin.com → activity → menu → **"export original"** → downloads a **.zip
containing the original .fit**. works in mobile browsers (verified by garmin forum
mvps: no computer needed). ~6–8 taps once logged in; available seconds-to-a-minute
after the watch syncs to the phone app. total flow ≈ 2 min, 100% tos-clean.
**implication for /admin: the upload endpoint must accept .zip (and .fit/.gpx/.tcx)
and unzip server-side** — that friction removal is what makes this path pleasant.

### 2. automated (add after mvp) — intervals.icu as bridge
free (donation-supported) training platform, **official garmin partner**: garmin
pushes activities to it automatically (<1–2 min after watch sync) via the official
connect developer api, so it survived garmin's jan-2026 auth crackdown. documented
personal api (basic auth with api key from settings): `GET /api/v1/activity/{id}/file`
returns **the original fit garmin delivered** (gzip); activity-list endpoint enables
polling. site design: "pull latest" button on /admin (+ optional daily cron). one-time
setup: intervals.icu account, connect garmin, api key in env.

### 3. bulk historical
primary: the **strava archive** already requested (original .fit for every activity).
backup: garmin's account "export your data" (gdpr archive) — original files under
`DI_CONNECT/DI-Connect-Uploaded-Files/`, 24–48 h turnaround.

## rejected / fallback-only paths
- **garmin connect mobile app**: has NO file export at all (2025–2026 versions);
  share-link exposes only a visual page behind cloudflare — no structured data.
- **official garmin connect developer program**: activity api does push original
  fit via webhooks, free, but the program is business-only; hobbyist approval
  is anecdotal. not dependable for us.
- **unofficial libraries**: in upheaval — garmin changed auth ~jan 5 2026 and
  cloudflare-blocks known mobile UAs; `garth` is deprecated (final release mar 2026).
  `python-garminconnect` v0.3.6 (jun 2026) works again (own mobile-sso auth, tls
  impersonation, downloads original fit zips) but expect 1–2 breakages/year, run
  from a residential ip, mfa token persistence needed. keep only as a self-hosted
  fallback script.
- **bridge apps**: rungap (ios, ~$10/yr, unofficial api, recovers from breakage
  quickly), healthfit (rebuilds fit from apple health — degraded fidelity for
  garmin sources), fitnesssyncer (~daily on free tier). all inferior to
  intervals.icu for this use.
- **watch usb / garmin express**: desktop-bound (/GARMIN/Activity via mtp), fine
  as offline backup, useless for phone-first.

## decision
mvp: /admin upload accepting zip/fit (path 1). phase 2: intervals.icu pull with
"pull latest" button (path 2). bulk import: strava archive, garmin gdpr export as
gap-filler (path 3).

sources: garmin support faqs + forums, developer.garmin.com program docs,
github (garth deprecation, python-garminconnect releases), intervals.icu api docs
& forum, rungap/healthfit docs. full trail in the research workflow output.
