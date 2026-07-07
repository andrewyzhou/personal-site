import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb, counters } from "@/lib/db";
import { ipHashFromRequest, parseTarget, rateLimit } from "@/lib/engagement";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// view counter: client fires once per session (sessionStorage flag); the server
// additionally caps per ip+target per hour so replays can't inflate it.
export async function POST(request: Request) {
  let body: { target?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: { code: "validation", message: "invalid body" } }, { status: 400 });
  }

  const target = parseTarget(body.target ?? null);
  if (!target) {
    return NextResponse.json({ error: { code: "validation", message: "bad target" } }, { status: 400 });
  }

  const ipHash = ipHashFromRequest(request);
  if (!(await rateLimit(`views:${target.type}:${target.slug}`, ipHash, 1, 3600))) {
    return NextResponse.json({ data: { counted: false } });
  }

  try {
    await getDb()
      .insert(counters)
      .values({ targetType: target.type, targetSlug: target.slug, kind: "view", count: 1 })
      .onConflictDoUpdate({
        target: [counters.targetType, counters.targetSlug, counters.kind],
        set: { count: sql`${counters.count} + 1` },
      });
    return NextResponse.json({ data: { counted: true } });
  } catch (error) {
    log.error("api:engagement/views", "increment failed", error);
    return NextResponse.json({ data: { counted: false } });
  }
}
