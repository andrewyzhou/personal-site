import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb, counters } from "@/lib/db";
import { CLAPS_PER_IP_PER_DAY, ipHashFromRequest, parseTarget, rateLimit } from "@/lib/engagement";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// claps: unlimited presses for anyone, batched client-side, capped per ip per
// target per day so it stays fun instead of abusable.
export async function POST(request: Request) {
  let body: { target?: string; count?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: { code: "validation", message: "invalid body" } }, { status: 400 });
  }

  const target = parseTarget(body.target ?? null);
  const count = Math.min(Math.max(Math.round(Number(body.count) || 0), 1), 30); // one batch ≤ 30
  if (!target) {
    return NextResponse.json({ error: { code: "validation", message: "bad target" } }, { status: 400 });
  }

  const ipHash = ipHashFromRequest(request);
  // daily per-ip-per-target cap, counted in clap units
  const allowed = await rateLimit(`claps:${target.type}:${target.slug}`, ipHash, CLAPS_PER_IP_PER_DAY, 86400);
  if (!allowed) {
    return NextResponse.json({ error: { code: "rate_limited", message: "you've clapped plenty today 👏" } }, { status: 429 });
  }

  try {
    const rows = await getDb()
      .insert(counters)
      .values({ targetType: target.type, targetSlug: target.slug, kind: "clap", count })
      .onConflictDoUpdate({
        target: [counters.targetType, counters.targetSlug, counters.kind],
        set: { count: sql`${counters.count} + ${count}` },
      })
      .returning({ count: counters.count });

    return NextResponse.json({ data: { claps: rows[0]?.count ?? count } });
  } catch (error) {
    log.error("api:engagement/claps", "increment failed", error);
    return NextResponse.json({ error: { code: "internal", message: "clap failed" } }, { status: 500 });
  }
}
