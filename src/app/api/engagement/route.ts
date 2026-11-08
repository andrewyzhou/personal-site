import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb, counters } from "@/lib/db";
import { parseTarget } from "@/lib/engagement";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// one round trip for the claps and views on a page. degrades to zeroes when
// the db is down — engagement never blocks content.
export async function GET(request: Request) {
  const target = parseTarget(new URL(request.url).searchParams.get("target"));
  if (!target) {
    return NextResponse.json({ error: { code: "validation", message: "bad target" } }, { status: 400 });
  }

  try {
    const counterRows = await getDb()
      .select({ kind: counters.kind, count: counters.count })
      .from(counters)
      .where(and(eq(counters.targetType, target.type), eq(counters.targetSlug, target.slug)));

    const claps = counterRows.find((c) => c.kind === "clap")?.count ?? 0;
    const views = counterRows.find((c) => c.kind === "view")?.count ?? 0;
    return NextResponse.json({ data: { claps, views } });
  } catch (error) {
    log.error("api:engagement", "summary failed", error);
    return NextResponse.json({ data: { claps: 0, views: 0 } });
  }
}
