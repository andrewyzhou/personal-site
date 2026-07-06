import { NextResponse } from "next/server";
import { getNowPlaying } from "@/lib/spotify";
import { getCachedData } from "@/lib/cache";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic"; // disable next.js caching, we use redis

export async function GET() {
  try {
    const { data, fetchedAt, previousFetchedAt, stale } = await getCachedData("spotify", getNowPlaying);

    // explicit null body when there's no track — spreading null used to produce a
    // truthy `{fetchedAt}` object that crashed the client (spotify.title undefined)
    if (data === null) {
      return NextResponse.json(null);
    }

    return NextResponse.json({ ...data, fetchedAt, previousFetchedAt, stale });
  } catch (error) {
    log.error("api:spotify", "request failed", error);
    return NextResponse.json(null, { status: 500 });
  }
}
