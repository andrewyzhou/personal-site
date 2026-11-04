// POST /api/admin/activities/[id]/suggestions/[sid] { action: "accept" | "dismiss" }
//   accept  → open suggestions with an edit only: the edit is validated again,
//             recorded with note "accepted: <summary>", the suggestion stamped
//             accepted (+ editId, decidedAt), then the activity republished
//   dismiss → open suggestions only: stamped dismissed (+ decidedAt)
// both are idempotent: repeating the same decision returns the stored result.
// undoing an accept = reverting its edit (the suggestion stays accepted).
//
// 200 { ok: true, suggestion: { id, status, editId, decidedAt }, unchanged: boolean,
//       republished: { [activityId]: status | "failed" } }
// 400 bad ids / action / stored edit invalid · 401 · 404 not on this activity ·
// 409 already decided the other way, or information-only (no edit) · 500
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { decideSuggestion, getSuggestion, insertEdit, listEdits, revertEditOnce } from "@/lib/cleaning/load";
import { combineCrop } from "@/lib/cleaning/edits";
import { DIRECT_EDIT_KINDS, parseEditBody } from "@/lib/cleaning/plan";
import type { ActivitySuggestionRow } from "@/lib/db";
import { bad, failure, parseId, readJson, republishAll, type Ctx } from "../../cleaning/shared";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const view = (s: ActivitySuggestionRow) => ({ id: s.id, status: s.status, editId: s.editId, decidedAt: s.decidedAt });

export async function POST(request: Request, { params }: Ctx<"id" | "sid">) {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  const p = await params;
  const id = parseId(p.id);
  const sid = parseId(p.sid);
  if (!id || !sid) return bad("bad id");
  const body = await readJson(request);
  if (!body) return bad("invalid json body");
  const action = body.action;
  if (action !== "accept" && action !== "dismiss") return bad("action must be accept or dismiss");
  try {
    const s = await getSuggestion(sid);
    if (!s || s.activityId !== id) return bad("suggestion not found", 404);
    const want = action === "accept" ? "accepted" : "dismissed";
    if (s.status === want) return NextResponse.json({ ok: true, suggestion: view(s), unchanged: true, republished: {} });
    if (s.status !== "open") return bad(`suggestion is already ${s.status}`, 409);

    if (action === "dismiss") {
      await decideSuggestion(sid, "dismissed", null);
      const now = (await getSuggestion(sid)) ?? s;
      if (now.status !== "dismissed") return bad(`suggestion is already ${now.status}`, 409);
      return NextResponse.json({ ok: true, suggestion: view(now), unchanged: false, republished: await republishAll([id]) });
    }

    if (!s.edit) return bad("this suggestion is information only", 409);
    const edit = parseEditBody(s.edit.kind, s.edit.params, DIRECT_EDIT_KINDS);
    if (typeof edit === "string") return bad(`stored edit is invalid: ${edit}`);
    // a one-sided crop keeps the other side of the crop already in effect
    const params = edit.kind === "crop" ? combineCrop((await listEdits(id)).filter((e) => !e.revertedAt), edit.params) : edit.params;
    const editId = await insertEdit(id, edit.kind, params, `accepted: ${s.summary}`);
    if (!(await decideSuggestion(sid, "accepted", editId))) {
      // decided concurrently (e.g. auto-apply): drop ours, report theirs
      await revertEditOnce(editId);
      const now = (await getSuggestion(sid)) ?? s;
      if (now.status !== "accepted") return bad(`suggestion is already ${now.status}`, 409);
      return NextResponse.json({ ok: true, suggestion: view(now), unchanged: true, republished: {} });
    }
    const republished = await republishAll([id]);
    const now = (await getSuggestion(sid)) ?? { ...s, status: "accepted", editId };
    return NextResponse.json({ ok: true, suggestion: view(now), unchanged: false, republished });
  } catch (error) {
    return failure("admin:cleaning:suggestions", error);
  }
}
