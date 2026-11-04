import { NextResponse } from "next/server";
import { bearerMatches } from "@/lib/lift/auth";
import { loadSnapshot } from "@/lib/lift/sync/snapshot";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!bearerMatches(request.headers.get("authorization"), process.env.LIFT_APP_TOKEN)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  try {
    // personal data: never cached anywhere
    return NextResponse.json(await loadSnapshot(), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    log.error("api:lift/sync/snapshot", "snapshot failed", error);
    return NextResponse.json({ ok: false, error: "snapshot failed" }, { status: 500 });
  }
}
