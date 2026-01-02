import { NextResponse } from "next/server";
import { getCurrentlyReading } from "@/lib/literal";
import { getCachedData } from "@/lib/cache";

export const dynamic = "force-dynamic"; // disable next.js caching, we use redis

export async function GET() {
  try {
    const { data, fetchedAt, previousFetchedAt } = await getCachedData("literal", getCurrentlyReading);

    if (data === null) {
      return NextResponse.json(null);
    }

    return NextResponse.json({ ...data, fetchedAt, previousFetchedAt });
  } catch (error) {
    console.error("literal api error:", error);
    return NextResponse.json(null, { status: 500 });
  }
}
