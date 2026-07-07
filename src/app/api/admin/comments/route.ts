import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/admin-auth";
import { getDb, comments } from "@/lib/db";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET: latest comments across all targets (including hidden) for moderation
export async function GET(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  try {
    const rows = await getDb().select().from(comments).orderBy(desc(comments.createdAt)).limit(100);
    return NextResponse.json({ data: rows });
  } catch (error) {
    log.error("admin:comments", "list failed", error);
    return NextResponse.json({ error: { code: "internal", message: "list failed" } }, { status: 500 });
  }
}

// PATCH: hide/unhide; DELETE: remove permanently
export async function PATCH(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  try {
    const { id, hidden } = await request.json();
    if (!Number.isInteger(id) || typeof hidden !== "boolean") {
      return NextResponse.json({ error: { code: "validation", message: "id + hidden required" } }, { status: 400 });
    }
    await getDb().update(comments).set({ hidden }).where(eq(comments.id, id));
    log.info("admin:comments", `${hidden ? "hid" : "unhid"} comment ${id}`);
    return NextResponse.json({ data: { ok: true } });
  } catch (error) {
    log.error("admin:comments", "patch failed", error);
    return NextResponse.json({ error: { code: "internal", message: "update failed" } }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  try {
    const id = Number(new URL(request.url).searchParams.get("id"));
    if (!Number.isInteger(id)) {
      return NextResponse.json({ error: { code: "validation", message: "id required" } }, { status: 400 });
    }
    await getDb().delete(comments).where(eq(comments.id, id));
    log.info("admin:comments", `deleted comment ${id}`);
    return NextResponse.json({ data: { ok: true } });
  } catch (error) {
    log.error("admin:comments", "delete failed", error);
    return NextResponse.json({ error: { code: "internal", message: "delete failed" } }, { status: 500 });
  }
}
