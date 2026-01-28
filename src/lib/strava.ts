const CLIENT_ID = process.env.STRAVA_CLIENT_ID;
const CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.STRAVA_REFRESH_TOKEN;

const TOKEN_ENDPOINT = "https://www.strava.com/oauth/token";
const ACTIVITIES_ENDPOINT = "https://www.strava.com/api/v3/athlete/activities";

async function getAccessToken(): Promise<string> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });

  const data = await response.json();
  return data.access_token;
}

export interface StravaActivity {
  id: number;
  name: string;
  type: string;
  distance: number; // in meters
  movingTime: number; // in seconds
  startDate: string;
  elapsedTime: number;
}

// activity for calendar display and detail views
export interface CalendarActivity {
  id: number;
  name: string;
  type: string;
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
}

// fetch all activities with pagination, optionally after a timestamp
export async function getAllActivities(after?: number): Promise<CalendarActivity[]> {
  if (!REFRESH_TOKEN) {
    return [];
  }

  try {
    const accessToken = await getAccessToken();
    const allActivities: CalendarActivity[] = [];
    let page = 1;
    const perPage = 200;

    while (true) {
      const params = new URLSearchParams({
        per_page: perPage.toString(),
        page: page.toString(),
      });
      if (after) {
        params.set("after", after.toString());
      }

      const response = await fetch(`${ACTIVITIES_ENDPOINT}?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        throw new Error("Failed to fetch Strava activities");
      }

      const activities = await response.json();
      if (activities.length === 0) {
        break;
      }

      for (const activity of activities) {
        // convert to local date string (YYYY-MM-DD) and time (HH:MM)
        const [localDate, localTimeRaw] = activity.start_date_local.split("T");
        const localTime = localTimeRaw ? localTimeRaw.slice(0, 5) : "00:00";

        allActivities.push({
          id: activity.id,
          name: activity.name || "",
          type: activity.type,
          date: localDate,
          startTime: localTime,
          distance: activity.distance || 0,
          duration: activity.moving_time || 0,
          elapsedTime: activity.elapsed_time || 0,
          totalElevationGain: activity.total_elevation_gain || 0,
          averageSpeed: activity.average_speed || 0,
          maxSpeed: activity.max_speed || 0,
          averageHeartrate: activity.has_heartrate ? activity.average_heartrate : null,
          maxHeartrate: activity.has_heartrate ? activity.max_heartrate : null,
          averageCadence: activity.average_cadence || null,
          averageWatts: activity.average_watts || null,
          maxWatts: activity.max_watts || null,
          kilojoules: activity.kilojoules || null,
          description: activity.description || null,
          sufferScore: activity.suffer_score || null,
        });
      }

      if (activities.length < perPage) {
        break;
      }
      page++;
    }

    return allActivities;
  } catch (error) {
    console.error("Strava API error fetching all activities:", error);
    return [];
  }
}

export async function getLatestActivity(): Promise<StravaActivity | null> {
  if (!REFRESH_TOKEN) {
    return null;
  }

  try {
    const accessToken = await getAccessToken();

    const response = await fetch(`${ACTIVITIES_ENDPOINT}?per_page=1`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      throw new Error("Failed to fetch Strava activities");
    }

    const activities = await response.json();
    if (activities.length === 0) {
      return null;
    }

    const activity = activities[0];
    return {
      id: activity.id,
      name: activity.name,
      type: activity.type,
      distance: activity.distance,
      movingTime: activity.moving_time,
      startDate: activity.start_date,
      elapsedTime: activity.elapsed_time,
    };
  } catch (error) {
    console.error("Strava API error:", error);
    return null;
  }
}

// format distance in miles
export function formatDistance(meters: number): string {
  const miles = meters / 1609.344;
  return `${miles.toFixed(1)} mi`;
}

// format time as "Xh Ymin" or "Ymin"
export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (hours > 0) {
    return `${hours} hr ${minutes} min`;
  }
  return `${minutes} min`;
}

// format pace as min:sec per mile (for running activities)
export function formatPace(metersPerSecond: number): string {
  if (metersPerSecond <= 0) return "--:--";
  const secondsPerMile = 1609.344 / metersPerSecond;
  const minutes = Math.floor(secondsPerMile / 60);
  const seconds = Math.round(secondsPerMile % 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")}/mi`;
}

// format speed in mph (for cycling activities)
export function formatSpeed(metersPerSecond: number): string {
  if (metersPerSecond <= 0) return "0 mph";
  const mph = metersPerSecond * 2.23694;
  return `${mph.toFixed(1)} mph`;
}

// format elevation in feet
export function formatElevation(meters: number): string {
  const feet = meters * 3.28084;
  return `${Math.round(feet)} ft`;
}

// format heartrate
export function formatHeartrate(bpm: number): string {
  return `${Math.round(bpm)} bpm`;
}

// format time of day (24h to 12h)
export function formatTimeOfDay(time24: string): string {
  const [hours, minutes] = time24.split(":").map(Number);
  const period = hours >= 12 ? "pm" : "am";
  const hours12 = hours % 12 || 12;
  return `${hours12}:${minutes.toString().padStart(2, "0")} ${period}`;
}

// format relative time
export function formatTimeAgo(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffHours / 24);

  if (diffHours < 1) {
    return "just now";
  } else if (diffHours < 24) {
    return `${diffHours}h ago`;
  } else if (diffDays === 1) {
    return "yesterday";
  } else if (diffDays < 7) {
    return `${diffDays}d ago`;
  } else {
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
}

// generate auth URL for initial OAuth flow
export function getAuthUrl(): string {
  const redirectUri = `${process.env.NEXT_PUBLIC_SITE_URL}/api/strava/callback`;
  const scopes = "activity:read_all";

  const params = new URLSearchParams({
    client_id: CLIENT_ID || "",
    response_type: "code",
    redirect_uri: redirectUri,
    scope: scopes,
  });

  return `https://www.strava.com/oauth/authorize?${params.toString()}`;
}
