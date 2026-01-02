import { NextRequest, NextResponse } from "next/server";

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const BASIC_AUTH = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get("code");
  const error = searchParams.get("error");

  if (error) {
    return NextResponse.json({ error }, { status: 400 });
  }

  if (!code) {
    return NextResponse.json({ error: "no code provided" }, { status: 400 });
  }

  const redirectUri = `${process.env.NEXT_PUBLIC_SITE_URL}/api/spotify/callback`;

  try {
    const response = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${BASIC_AUTH}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      }),
    });

    const data = await response.json();

    if (data.error) {
      return NextResponse.json({ error: data.error }, { status: 400 });
    }

    // display the refresh token - you'll need to copy this to your .env.local
    return new NextResponse(
      `
      <html>
        <body style="font-family: monospace; padding: 40px; background: #101010; color: #EEEEEE;">
          <h1>Spotify Auth Success!</h1>
          <p>Copy this refresh token to your .env.local file as SPOTIFY_REFRESH_TOKEN:</p>
          <pre style="background: #1a1a1a; padding: 20px; word-break: break-all; white-space: pre-wrap;">${data.refresh_token}</pre>
          <p style="color: #AAAAAA;">You can close this window now.</p>
        </body>
      </html>
      `,
      {
        headers: { "Content-Type": "text/html" },
      }
    );
  } catch (error) {
    console.error("spotify token exchange error:", error);
    return NextResponse.json({ error: "token exchange failed" }, { status: 500 });
  }
}
