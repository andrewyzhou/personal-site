// wall-clock <-> utc helpers. strong's share text has no zone, so the zone
// comes from a linked watch recording when possible, else LIFT_TIMEZONE.

export const DEFAULT_LIFT_TIMEZONE = "America/Los_Angeles";

export function liftTimezone(): string {
  return process.env.LIFT_TIMEZONE || DEFAULT_LIFT_TIMEZONE;
}

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** minutes east of utc for `tz` at instant `ms` */
function zoneOffsetMin(ms: number, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(ms));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000);
}

/** "YYYY-MM-DDTHH:MM" in `tz` -> utc instant + offset. null for malformed input or zone. */
export function localToUtc(local: string, tz: string): { date: Date; utcOffsetMin: number } | null {
  const m = LOCAL_RE.exec(local);
  if (!m) return null;
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  try {
    // two passes so a guess on the wrong side of a dst change corrects itself
    let offset = zoneOffsetMin(wall, tz);
    offset = zoneOffsetMin(wall - offset * 60000, tz);
    return { date: new Date(wall - offset * 60000), utcOffsetMin: offset };
  } catch {
    return null;
  }
}

/** utc instant -> "YYYY-MM-DDTHH:MM" wall clock in `tz` */
export function utcToLocal(date: Date, tz: string): string {
  const offset = zoneOffsetMin(date.getTime(), tz);
  return new Date(date.getTime() + offset * 60000).toISOString().slice(0, 16);
}

/** shift a 'YYYY-MM-DD' by whole days */
export function addDays(localDate: string, days: number): string {
  const [y, mo, d] = localDate.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d + days)).toISOString().slice(0, 10);
}
