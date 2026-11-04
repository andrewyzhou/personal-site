-- backfill the v2 data layer from the legacy single-source columns. additive
-- only: legacy columns (source, external_id, fit_*, trim_*) are left untouched.
-- re-runnable: conflict-do-nothing / not-exists guards on every insert.

-- one source row per activity. strava-archive / strava-api / manual (csv-only
-- archive rows) all carry a strava activity id. fit_sha256 is the sha of the
-- original's bytes as stored, which is what the raw store keys on.
INSERT INTO "activity_sources" ("activity_id", "provider", "external_id", "kind", "raw_sha256", "created_at")
SELECT
	a."id",
	CASE a."source"
		WHEN 'strava-archive' THEN 'strava'
		WHEN 'strava-api' THEN 'strava'
		WHEN 'manual' THEN 'strava'
		WHEN 'intervals-icu' THEN 'intervals-icu'
		ELSE 'upload'
	END,
	a."external_id",
	CASE WHEN a."fit_sha256" IS NOT NULL THEN 'device-file' ELSE 'summary' END,
	a."fit_sha256",
	a."created_at"
FROM "activities" a
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- the current trim becomes an explicit edit for every activity with a route or
-- an original (legacy imports trimmed gps-less files too), so
-- republish reproduces it exactly (including deliberate 0 m trims) instead of
-- falling back to the default for new activities
INSERT INTO "activity_edits" ("activity_id", "kind", "params", "note", "created_at")
SELECT
	a."id",
	'trim',
	jsonb_build_object('startM', a."trim_start_m", 'endM', a."trim_end_m"),
	'backfilled from legacy trim columns',
	a."created_at"
FROM "activities" a
WHERE (a."polyline" IS NOT NULL OR a."fit_sha256" IS NOT NULL)
	AND NOT EXISTS (
		SELECT 1 FROM "activity_edits" e WHERE e."activity_id" = a."id" AND e."kind" = 'trim'
	);
