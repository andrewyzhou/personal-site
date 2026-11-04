// POST /api/admin/activities/[id]/merge { otherId }
// the later-starting activity is always merged into the earlier one (either
// may be [id]). the absorbed one gets a 'merged-into' marker
// { intoActivityId, wasHidden } and is hidden; then the target gets a 'merge'
// { withActivityId } edit and is republished. refused: itself, more than 12 h
// apart, chains (target merged elsewhere, absorbed has its own merges), an
// activity already merged elsewhere, an absorbed one more private than the
// target (hidden, or map / hr hidden where the target isn't), split halves
// and split parents, route-only tracks, and crops at the joint (target end,
// absorbed start). repeating a merge resumes or returns the existing one.
// undo = revert the merge edit.
//
// 200 { ok: true, targetId, absorbedId, mergeEditId, markerEditId, unchanged: boolean,
//       republished: { [activityId]: status | "failed" } }
// 400 bad ids / itself / too far apart · 401 · 404 · 409 refused ·
// 422 no track / route-only track · 503 track unreadable · 500
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { getActivity, insertEdit, listEdits, loadTrackForRow, setHidden } from "@/lib/cleaning/load";
import { validateCleaningEdit } from "@/lib/cleaning/edits";
import { planMerge } from "@/lib/cleaning/plan";
import { defaultDeps, trackCandidates } from "@/lib/republish";
import { bad, failure, parseId, readJson, refreshCaches, republishAll, type Ctx } from "../cleaning/shared";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const active = async (activityId: number) => (await listEdits(activityId)).filter((e) => !e.revertedAt);

export async function POST(request: Request, { params }: Ctx) {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  const id = parseId((await params).id);
  if (!id) return bad("bad id");
  const body = await readJson(request);
  if (!body) return bad("invalid json body");
  const otherId = typeof body.otherId === "number" ? parseId(String(body.otherId)) : null;
  if (!otherId) return bad("otherId must be an activity id");
  if (otherId === id) return bad("can't merge an activity into itself");
  try {
    const [a, b] = await Promise.all([getActivity(id), getActivity(otherId)]);
    if (!a || !b) return bad("not found", 404);
    const [aEdits, bEdits] = await Promise.all([active(a.id), active(b.id)]);
    const plan = planMerge({ row: a, edits: aEdits }, { row: b, edits: bEdits });
    if (!plan.ok) return bad(plan.error, plan.status);
    const { targetId, absorbedId } = plan;
    const absorbed = absorbedId === a.id ? a : b;

    if (plan.alreadyMerged) {
      const republished = await republishAll([targetId]);
      await refreshCaches([absorbedId]);
      return NextResponse.json({ ok: true, targetId, absorbedId, mergeEditId: plan.mergeEditId, markerEditId: plan.markerId, unchanged: true, republished });
    }

    // both need a timed track: republish ignores merges on trackless rows,
    // and route-only tracks have no real clock to join on
    const deps = defaultDeps();
    const synthetic: Record<number, boolean> = {};
    for (const r of [a, b]) {
      if (!trackCandidates(await deps.loadSources(r.id)).length) return bad(`activity ${r.id} has no track to merge`, 422);
      const load = await loadTrackForRow(r, deps);
      if (load.status === "no-track" || load.status === "not-found") return bad(`activity ${r.id} has no track to merge`, 422);
      if (load.status !== "ok") return bad(`activity ${r.id}: the original file can't be read right now`, 503);
      synthetic[r.id] = load.track.syntheticTime;
    }
    const checked = planMerge({ row: a, edits: aEdits, syntheticTime: synthetic[a.id] }, { row: b, edits: bEdits, syntheticTime: synthetic[b.id] });
    if (!checked.ok) return bad(checked.error, checked.status);
    const mergeEdit = validateCleaningEdit("merge", { withActivityId: absorbedId });
    if (!mergeEdit.ok) return bad(mergeEdit.error);

    // absorbed side first: a failure midway hides data, never shows it twice
    const markerEditId = plan.markerId ?? (await insertEdit(absorbedId, "merged-into", { intoActivityId: targetId, wasHidden: absorbed.hidden }, `merged into #${targetId}`));
    await setHidden(absorbedId, true);
    const mergeEditId = plan.mergeEditId ?? (await insertEdit(targetId, "merge", mergeEdit.params, `merged #${absorbedId}`));

    const republished = await republishAll([targetId]);
    await refreshCaches([absorbedId]);
    return NextResponse.json({ ok: true, targetId, absorbedId, mergeEditId, markerEditId, unchanged: false, republished });
  } catch (error) {
    return failure("admin:cleaning:merge", error);
  }
}
