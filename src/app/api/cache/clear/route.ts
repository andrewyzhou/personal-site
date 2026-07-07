import { NextResponse } from "next/server";
import { Redis } from "@upstash/redis";
import { isAdminRequest, unauthorizedResponse } from "@/lib/admin-auth";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";

const redis = new Redis({
  url: process.env.KV_REST_API_URL || "",
  token: process.env.KV_REST_API_TOKEN || "",
});

export async function POST(request: Request) {
  if (!(await isAdminRequest(request))) {
    return unauthorizedResponse();
  }

  try {
    const { key } = await request.json();

    if (!key) {
      return NextResponse.json({ error: "key is required" }, { status: 400 });
    }

    await redis.del(key);
    log.info("api:cache/clear", `cleared redis key: ${key}`);

    return NextResponse.json({ success: true, deleted: key });
  } catch (error) {
    log.error("api:cache/clear", "failed to clear cache key", error);
    return NextResponse.json({ success: false, error: "cache clear failed" }, { status: 500 });
  }
}
