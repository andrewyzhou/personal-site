// runtime shape guards for api responses consumed by client components. the api
// returns loosely-typed json (and a bug once produced `{fetchedAt}`-only objects
// when an upstream died), so client code must verify required fields before
// trusting a payload.

function isRecord(d: unknown): d is Record<string, unknown> {
  return typeof d === "object" && d !== null;
}

// spotify: rendering requires title + artist strings
export function isSpotifyTrack(d: unknown): boolean {
  return isRecord(d) && typeof d.title === "string" && typeof d.artist === "string";
}

// strava: rendering requires id, type, startDate and both formatted metrics
export function isStravaActivity(d: unknown): boolean {
  return (
    isRecord(d) &&
    typeof d.id === "number" &&
    typeof d.type === "string" &&
    typeof d.startDate === "string" &&
    typeof d.formattedDistance === "string" &&
    typeof d.formattedDuration === "string"
  );
}

// literal book: rendering requires a title string (authors are optional-chained)
export function isLiteralBook(d: unknown): boolean {
  return isRecord(d) && typeof d.title === "string";
}

// stats counter payload
export function isStatsPayload(d: unknown): boolean {
  return isRecord(d) && typeof d.prevCount === "number" && typeof d.apiCalls === "number";
}
