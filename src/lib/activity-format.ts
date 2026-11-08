// display formatting for activity stats — one shared place for the new
// activity surfaces (detail page, admin preview). matches the conventions in
// ActivityCalendar (pace for foot sports, speed for rides, duration-only types).

import { SPORT_TYPE_KEYS, sportTypeIcon, sportTypeLabel, typesWithMetric } from "./sport-types";

// all derived from the sport-type table (src/lib/sport-types.ts)
export const PACE_TYPES: ReadonlySet<string> = new Set(typesWithMetric("pace"));
export const SPEED_TYPES: ReadonlySet<string> = new Set(typesWithMetric("speed"));
export const DURATION_ONLY_TYPES: ReadonlySet<string> = new Set(typesWithMetric("duration"));

export const SPORT_ICONS: Record<string, string> = Object.fromEntries(SPORT_TYPE_KEYS.map((k) => [k, sportTypeIcon(k)]));

export const SPORT_LABELS: Record<string, string> = Object.fromEntries(SPORT_TYPE_KEYS.map((k) => [k, sportTypeLabel(k)]));

export function sportIcon(type: string): string {
  return sportTypeIcon(type);
}

export function sportLabel(type: string): string {
  return sportTypeLabel(type);
}

export function formatClockDuration(totalSeconds: number): string {
  const s = Math.round(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}

export function formatMiles(meters: number): string {
  return `${(meters / 1609.344).toFixed(2)} mi`;
}

// pace as min/mi from m/s
export function formatPace(avgSpeedMs: number): string {
  if (avgSpeedMs <= 0) return "—";
  const secPerMile = 1609.344 / avgSpeedMs;
  const m = Math.floor(secPerMile / 60);
  const s = Math.round(secPerMile % 60);
  return `${m}:${String(s).padStart(2, "0")} /mi`;
}

// "3.1 mi" (one decimal; the "currently" workout sentence)
export function formatDistanceShort(meters: number): string {
  return `${(meters / 1609.344).toFixed(1)} mi`;
}

// "1 hr 5 min" or "42 min"
export function formatDurationWords(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours > 0 ? `${hours} hr ${minutes} min` : `${minutes} min`;
}

// "just now" / "5h ago" / "yesterday" / "3d ago" / "oct 3"
export function formatTimeAgo(dateString: string, now: Date = new Date()): string {
  const date = new Date(dateString);
  const diffHours = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60));
  const diffDays = Math.floor(diffHours / 24);
  if (diffHours < 1) return "just now";
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function formatMph(avgSpeedMs: number): string {
  return `${(avgSpeedMs * 2.23694).toFixed(1)} mph`;
}

export function formatFeet(meters: number): string {
  return `${Math.round(meters * 3.28084)} ft`;
}

// "sunday, july 6" + "7:12 am" from the stored local date/time strings
export function formatLocalDateLine(localDate: string, localTime: string): { dateLine: string; timeLine: string } {
  const d = new Date(`${localDate}T00:00:00`);
  const weekday = d.toLocaleDateString("en-US", { weekday: "long" }).toLowerCase();
  const month = d.toLocaleDateString("en-US", { month: "long" }).toLowerCase();
  const dateLine = `${weekday}, ${month} ${d.getDate()}`;

  const [hStr, mStr] = localTime.split(":");
  let h = Number(hStr);
  const ampm = h >= 12 ? "pm" : "am";
  h = h % 12 === 0 ? 12 : h % 12;
  return { dateLine, timeLine: `${h}:${mStr} ${ampm}` };
}
