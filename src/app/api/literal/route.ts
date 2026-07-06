import { NextResponse } from "next/server";
import { getCurrentlyReading } from "@/lib/literal";
import { getCachedData } from "@/lib/cache";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic"; // disable next.js caching, we use redis

export async function GET() {
  try {
    const { data, fetchedAt, previousFetchedAt, stale } = await getCachedData("literal", getCurrentlyReading);

    if (data === null) {
      return NextResponse.json(null);
    }

    return NextResponse.json({ ...data, fetchedAt, previousFetchedAt, stale });
  } catch (error) {
    log.error("api:literal", "request failed", error);
    return NextResponse.json(null, { status: 500 });
  }
}
