import { NextResponse } from "next/server";
import { getDb, comments } from "@/lib/db";
import { filterComment, ipHashFromRequest, isDuplicateComment, parseTarget, rateLimit } from "@/lib/engagement";
import { getSessionUser } from "@/lib/auth";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// guests and signed-in users both auto-publish through the simple filter chain.
export async function POST(request: Request) {
  let body: { target?: string; body?: string; authorName?: string; website?: string };
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
  if (!(await rateLimit("comments", ipHash, 5, 600))) {
    return NextResponse.json({ error: { code: "rate_limited", message: "too many comments — slow down" } }, { status: 429 });
  }

  let me: { email: string | null } | null = null;
  try {
    me = await getSessionUser();
  } catch {
    me = null;
  }

  const text = (body.body ?? "").trim();
  const rawName = (body.authorName ?? "").trim();
  const authorName = me?.email
    ? rawName || me.email.split("@")[0]
    : rawName || "anon";

  const rejection = filterComment({ body: text, authorName, honeypot: body.website ?? "" });
  if (rejection === "rejected") {
    // honeypot: pretend success so bots learn nothing
    return NextResponse.json({ data: { ok: true } }, { status: 201 });
  }
  if (rejection) {
    return NextResponse.json({ error: { code: "validation", message: rejection } }, { status: 400 });
  }

  try {
    if (await isDuplicateComment(target.type, target.slug, text)) {
      return NextResponse.json({ error: { code: "validation", message: "looks like a duplicate comment" } }, { status: 400 });
    }

    const rows = await getDb()
      .insert(comments)
      .values({
        targetType: target.type,
        targetSlug: target.slug,
        authorName: authorName.slice(0, 40),
        authorEmail: me?.email ?? null,
        isGuest: !me?.email,
        body: text,
        ipHash,
      })
      .returning({
        id: comments.id,
        authorName: comments.authorName,
        isGuest: comments.isGuest,
        body: comments.body,
        createdAt: comments.createdAt,
      });

    log.info("engagement", `comment on ${target.type}:${target.slug} (${me?.email ? "user" : "guest"})`);
    return NextResponse.json({ data: rows[0] }, { status: 201 });
  } catch (error) {
    log.error("api:engagement/comments", "insert failed", error);
    return NextResponse.json({ error: { code: "internal", message: "comment failed — try again in a minute" } }, { status: 500 });
  }
}
