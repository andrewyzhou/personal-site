import { NextRequest, NextResponse } from "next/server";

const CLIENT_ID = process.env.STRAVA_CLIENT_ID;
const CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET;

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

  try {
    const response = await fetch("https://www.strava.com/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code,
        grant_type: "authorization_code",
      }),
    });

    const data = await response.json();

    if (data.errors) {
      return NextResponse.json({ error: data.errors }, { status: 400 });
    }

    // display the refresh token - you'll need to copy this to your .env.local
    return new NextResponse(
      `
      <html>
        <body style="font-family: monospace; padding: 40px; background: #101010; color: #EEEEEE;">
          <h1>Strava Auth Success!</h1>
          <p>Copy this refresh token to your .env.local file as STRAVA_REFRESH_TOKEN:</p>
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
    console.error("strava token exchange error:", error);
    return NextResponse.json({ error: "token exchange failed" }, { status: 500 });
  }
}
