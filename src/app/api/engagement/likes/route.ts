import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { getDb, likes } from "@/lib/db";
import { ipHashFromRequest, parseTarget, rateLimit } from "@/lib/engagement";
import { getSessionUser } from "@/lib/auth";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// toggle like — signed-in users only; the ui prompts guests to sign in.
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

  const me = await getSessionUser().catch(() => null);
  if (!me?.email) {
    return NextResponse.json({ error: { code: "unauthorized", message: "sign in to like" } }, { status: 401 });
  }

  if (!(await rateLimit("likes", ipHashFromRequest(request), 30, 60))) {
    return NextResponse.json({ error: { code: "rate_limited", message: "slow down" } }, { status: 429 });
  }

  try {
    const db = getDb();
    const where = and(
      eq(likes.targetType, target.type),
      eq(likes.targetSlug, target.slug),
      eq(likes.userEmail, me.email)
    );
    const existing = await db.select({ id: likes.id }).from(likes).where(where).limit(1);

    let liked: boolean;
    if (existing.length > 0) {
      await db.delete(likes).where(where);
      liked = false;
    } else {
      await db
        .insert(likes)
        .values({ targetType: target.type, targetSlug: target.slug, userEmail: me.email })
        .onConflictDoNothing();
      liked = true;
    }

    const count = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(likes)
      .where(and(eq(likes.targetType, target.type), eq(likes.targetSlug, target.slug)));

    return NextResponse.json({ data: { liked, likes: count[0]?.count ?? 0 } });
  } catch (error) {
    log.error("api:engagement/likes", "toggle failed", error);
    return NextResponse.json({ error: { code: "internal", message: "like failed" } }, { status: 500 });
  }
}
