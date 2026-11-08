// the activity shape the calendar, training feed and detail views consume.
// built from a db row by rowToCalendarActivity (src/lib/activities.ts).
export interface CalendarActivity {
  id: number;
  name: string;
  type: string; // canonical sport type (src/lib/sport-types.ts)
  date: string; // YYYY-MM-DD format (local date)
  startTime: string; // HH:MM format (local time)
  distance: number; // in meters
  duration: number; // in seconds (moving time)
  elapsedTime: number; // in seconds (total elapsed time)
  totalElevationGain: number; // in meters
  averageSpeed: number; // in meters per second
  maxSpeed: number; // in meters per second
  averageHeartrate: number | null;
  maxHeartrate: number | null;
  averageCadence: number | null;
  averageWatts: number | null;
  maxWatts: number | null;
  kilojoules: number | null;
  description: string | null;
  sufferScore: number | null;
  // set on entries with their own page (lift-only workouts); absent for recordings
  href?: string;
  // "3 exercises · 6 sets" on lift-only entries, shown instead of a 0 min time
  liftSummary?: string;
}
