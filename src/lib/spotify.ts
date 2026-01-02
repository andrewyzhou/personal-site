const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.SPOTIFY_REFRESH_TOKEN;

const BASIC_AUTH = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
const TOKEN_ENDPOINT = "https://accounts.spotify.com/api/token";
const NOW_PLAYING_ENDPOINT = "https://api.spotify.com/v1/me/player/currently-playing";
const RECENTLY_PLAYED_ENDPOINT = "https://api.spotify.com/v1/me/player/recently-played?limit=1";

async function getAccessToken(): Promise<string> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Basic ${BASIC_AUTH}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: REFRESH_TOKEN || "",
    }),
  });

  const data = await response.json();
  return data.access_token;
}

export interface SpotifyTrack {
  isPlaying: boolean;
  title: string;
  artist: string;
  albumArt?: string;
  songUrl?: string;
  playedAt?: string;
}

export async function getNowPlaying(): Promise<SpotifyTrack | null> {
  if (!REFRESH_TOKEN) {
    return null;
  }

  try {
    const accessToken = await getAccessToken();

    // try currently playing first
    const nowPlayingResponse = await fetch(NOW_PLAYING_ENDPOINT, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (nowPlayingResponse.status === 200) {
      const data = await nowPlayingResponse.json();
      if (data.item) {
        return {
          isPlaying: data.is_playing,
          title: data.item.name,
          artist: data.item.artists.map((a: { name: string }) => a.name).join(", "),
          albumArt: data.item.album.images[0]?.url,
          songUrl: data.item.external_urls.spotify,
        };
      }
    }

    // fall back to recently played
    const recentlyPlayedResponse = await fetch(RECENTLY_PLAYED_ENDPOINT, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (recentlyPlayedResponse.status === 200) {
      const data = await recentlyPlayedResponse.json();
      if (data.items && data.items.length > 0) {
        const item = data.items[0];
        const track = item.track;
        return {
          isPlaying: false,
          title: track.name,
          artist: track.artists.map((a: { name: string }) => a.name).join(", "),
          albumArt: track.album.images[0]?.url,
          songUrl: track.external_urls.spotify,
          playedAt: item.played_at,
        };
      }
    }

    return null;
  } catch (error) {
    console.error("spotify api error:", error);
    return null;
  }
}

// generate auth URL for initial OAuth flow
export function getAuthUrl(): string {
  const scopes = ["user-read-currently-playing", "user-read-recently-played"];
  const redirectUri = `${process.env.NEXT_PUBLIC_SITE_URL}/api/spotify/callback`;

  const params = new URLSearchParams({
    client_id: CLIENT_ID || "",
    response_type: "code",
    redirect_uri: redirectUri,
    scope: scopes.join(" "),
  });

  return `https://accounts.spotify.com/authorize?${params.toString()}`;
}
