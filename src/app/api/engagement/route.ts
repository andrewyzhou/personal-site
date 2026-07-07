import { NextResponse } from "next/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { getDb, comments, likes, counters } from "@/lib/db";
import { parseTarget } from "@/lib/engagement";
import { getSessionUser } from "@/lib/auth";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// one round trip for everything the engagement ui needs on a page. degrades to
// zeroes when the db is down — engagement never blocks content.
export async function GET(request: Request) {
  const target = parseTarget(new URL(request.url).searchParams.get("target"));
  if (!target) {
    return NextResponse.json({ error: { code: "validation", message: "bad target" } }, { status: 400 });
  }

  let me: { email: string | null; name?: string | null; isAdmin: boolean } | null = null;
  try {
    me = await getSessionUser();
  } catch {
    me = null;
  }

  try {
    const db = getDb();
    const where = and(eq(comments.targetType, target.type), eq(comments.targetSlug, target.slug));

    const [commentRows, likeCount, myLike, counterRows] = await Promise.all([
      db
        .select({
          id: comments.id,
          authorName: comments.authorName,
          isGuest: comments.isGuest,
          body: comments.body,
          createdAt: comments.createdAt,
        })
        .from(comments)
        .where(and(where, eq(comments.hidden, false)))
        .orderBy(desc(comments.createdAt))
        .limit(200),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(likes)
        .where(and(eq(likes.targetType, target.type), eq(likes.targetSlug, target.slug))),
      me?.email
        ? db
            .select({ id: likes.id })
            .from(likes)
            .where(
              and(
                eq(likes.targetType, target.type),
                eq(likes.targetSlug, target.slug),
                eq(likes.userEmail, me.email)
              )
            )
            .limit(1)
        : Promise.resolve([]),
      db
        .select({ kind: counters.kind, count: counters.count })
        .from(counters)
        .where(and(eq(counters.targetType, target.type), eq(counters.targetSlug, target.slug))),
    ]);

    const claps = counterRows.find((c) => c.kind === "clap")?.count ?? 0;
    const views = counterRows.find((c) => c.kind === "view")?.count ?? 0;

    return NextResponse.json({
      data: {
        comments: commentRows,
        likes: likeCount[0]?.count ?? 0,
        liked: myLike.length > 0,
        claps,
        views,
        me: me ? { name: me.email?.split("@")[0] ?? "me", signedIn: true } : { signedIn: false },
      },
    });
  } catch (error) {
    log.error("api:engagement", "summary failed", error);
    return NextResponse.json({
      data: { comments: [], likes: 0, liked: false, claps: 0, views: 0, me: { signedIn: !!me } },
    });
  }
}
