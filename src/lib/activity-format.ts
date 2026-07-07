// display formatting for activity stats — one shared place for the new
// activity surfaces (detail page, admin preview). matches the conventions in
// ActivityCalendar (pace for foot sports, speed for rides, duration-only types).

export const PACE_TYPES = new Set(["Run", "TrailRun", "VirtualRun", "Walk", "Hike"]);
export const SPEED_TYPES = new Set(["Ride", "VirtualRide", "MountainBikeRide", "GravelRide"]);
export const DURATION_ONLY_TYPES = new Set([
  "WeightTraining", "Workout", "Yoga", "Crossfit", "Tennis", "Soccer", "RockClimbing",
]);

export const SPORT_ICONS: Record<string, string> = {
  Run: "run", TrailRun: "trailrun", VirtualRun: "run",
  Ride: "ride", VirtualRide: "ride", MountainBikeRide: "ride", GravelRide: "ride",
  Swim: "swim", Walk: "walk", Hike: "hike",
  WeightTraining: "weight", Workout: "workout", Yoga: "yoga",
  Tennis: "tennis", Soccer: "soccer", RockClimbing: "climb",
};

export const SPORT_LABELS: Record<string, string> = {
  Run: "run", TrailRun: "trail run", VirtualRun: "virtual run",
  Ride: "ride", VirtualRide: "virtual ride", MountainBikeRide: "mountain bike ride", GravelRide: "gravel ride",
  Swim: "swim", Walk: "walk", Hike: "hike",
  WeightTraining: "weight training", Workout: "workout", Yoga: "yoga",
  Tennis: "tennis", Soccer: "soccer", RockClimbing: "rock climbing",
};

export function sportIcon(type: string): string {
  return SPORT_ICONS[type] ?? "workout";
}

export function sportLabel(type: string): string {
  return SPORT_LABELS[type] ?? type.toLowerCase();
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
