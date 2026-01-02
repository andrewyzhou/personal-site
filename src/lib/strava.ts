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
  return `${miles.toFixed(1)}mi`;
}

// format time as "Xh Ymin" or "Ymin"
export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (hours > 0) {
    return `${hours}h ${minutes}min`;
  }
  return `${minutes}min`;
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
