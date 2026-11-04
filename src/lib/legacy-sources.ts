// legacy single-source columns → v2 activity_sources identity. mirrors the
// case expression in drizzle/0003_activities_v2_backfill.sql; keep them in sync.

import type { SourceProvider } from "./activity-sources";

export function legacyProvider(source: string | null | undefined): SourceProvider {
  switch (source) {
    // archive imports, api sync, and csv-only archive rows all carry a strava id
    case "strava-archive":
    case "strava-api":
    case "manual":
      return "strava";
    case "intervals-icu":
      return "intervals-icu";
    default:
      return "upload";
  }
}

// content type for a legacy public original, by file_type column
export function legacyContentType(fileType: string | null | undefined): string {
  switch (fileType) {
    case "gpx":
      return "application/gpx+xml";
    case "tcx":
      return "application/xml";
    default:
      return "application/octet-stream";
  }
}

export function basename(pathname: string): string {
  return pathname.slice(pathname.lastIndexOf("/") + 1);
}
