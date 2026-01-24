import { NextResponse } from "next/server";
import { Redis } from "@upstash/redis";

export const dynamic = "force-dynamic";

const redis = new Redis({
  url: process.env.KV_REST_API_URL || "",
  token: process.env.KV_REST_API_TOKEN || "",
});

export async function POST(request: Request) {
  try {
    const { key } = await request.json();

    if (!key) {
      return NextResponse.json({ error: "key is required" }, { status: 400 });
    }

    await redis.del(key);

    return NextResponse.json({ success: true, deleted: key });
  } catch (error) {
    console.error("Error clearing cache:", error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
