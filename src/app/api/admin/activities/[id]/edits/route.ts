// POST /api/admin/activities/[id]/edits { kind, params, note? }
// records one cleaning edit, then republishes. kinds: crop | cut | drop-points |
// no-gps (merge and split have their own routes). an edit the published
// columns can't reflect is reverted again (never left active).
//
// 200 { ok: true, editId: number, status: RepublishResult["status"] }
// 400 bad id / body / params · 401 · 404 · 422 no track (edit reverted) ·
// 503 track unreadable (edit reverted) · 500 (edit reverted)
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { getActivity, insertEdit, revertEditOnce } from "@/lib/cleaning/load";
import { DIRECT_EDIT_KINDS, parseEditBody } from "@/lib/cleaning/plan";
import { republish } from "@/lib/republish";
import { log } from "@/lib/log";
import { bad, parseId, readJson, refreshCaches, type Ctx } from "../cleaning/shared";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_NOTE = 500;

export async function POST(request: Request, { params }: Ctx) {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  const id = parseId((await params).id);
  if (!id) return bad("bad id");
  const body = await readJson(request);
  if (!body) return bad("invalid json body");
  const edit = parseEditBody(body.kind, body.params, DIRECT_EDIT_KINDS);
  if (typeof edit === "string") return bad(edit);
  if (body.note !== undefined && body.note !== null && (typeof body.note !== "string" || body.note.length > MAX_NOTE)) {
    return bad(`note must be a string of at most ${MAX_NOTE} characters`);
  }
  const note = typeof body.note === "string" && body.note.trim() ? body.note.trim() : null;

  let editId: number | null = null;
  try {
    const row = await getActivity(id);
    if (!row) return bad("not found", 404);
    editId = await insertEdit(id, edit.kind, edit.params, note);
    const result = await republish(id);
    if (result.status === "no-source" || result.status === "not-found") {
      await revertEditOnce(editId);
      return bad("no track stored for this activity — nothing to clean", 422);
    }
    if (result.status === "source-unavailable") {
      await revertEditOnce(editId);
      return bad("track is unreadable right now — edit not applied", 503);
    }
    await refreshCaches([id]);
    return NextResponse.json({ ok: true, editId, status: result.status });
  } catch (error) {
    log.error("admin:cleaning:edits", `edit failed for ${id}`, error);
    if (editId !== null) await revertEditOnce(editId).catch(() => undefined);
    return bad("edit failed", 500);
  }
}
