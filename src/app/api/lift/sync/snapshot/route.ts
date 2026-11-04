import { NextResponse } from "next/server";
import { bearerMatches } from "@/lib/lift/auth";
import { loadSnapshotPage, parseSnapshotQuery } from "@/lib/lift/sync/snapshot";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// one entity page per request (see SyncSnapshotPage in lift-core)
export async function GET(request: Request) {
  if (!bearerMatches(request.headers.get("authorization"), process.env.LIFT_APP_TOKEN)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const parsed = parseSnapshotQuery(new URL(request.url).searchParams);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
  try {
    // personal data: never cached anywhere
    return NextResponse.json(await loadSnapshotPage(parsed.query), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    log.error("api:lift/sync/snapshot", `snapshot ${parsed.query.entity} failed`, error);
    return NextResponse.json({ ok: false, error: "snapshot failed" }, { status: 500 });
  }
}
