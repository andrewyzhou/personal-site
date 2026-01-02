import { NextResponse } from "next/server";
import { getNowPlaying } from "@/lib/spotify";
import { getCachedData } from "@/lib/cache";

export const dynamic = "force-dynamic"; // disable next.js caching, we use redis

export async function GET() {
  try {
    const { data, fetchedAt, previousFetchedAt } = await getCachedData("spotify", getNowPlaying);
    return NextResponse.json({ ...data, fetchedAt, previousFetchedAt });
  } catch (error) {
    console.error("spotify api error:", error);
    return NextResponse.json(null, { status: 500 });
  }
}
