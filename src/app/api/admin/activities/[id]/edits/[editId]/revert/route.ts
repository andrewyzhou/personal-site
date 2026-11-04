// POST /api/admin/activities/[id]/edits/[editId]/revert
// stamps reverted_at (nothing is deleted), then republishes what changed.
//   generic edit  → reverted, activity republished
//   split marker  → the child is hidden (never deleted), the parent crop the
//                   split made is reverted, then the marker; both republished
//   merge         → the merge is reverted and the target republished, then the
//                   absorbed activity gets its old hidden flag back and its
//                   merged-into marker is reverted; it is republished too
//   merged-into   → same as reverting the target's merge
// a reverted edit that came from a suggestion leaves the suggestion accepted,
// so auto-apply never re-applies it. repeating a revert is a no-op that
// finishes any step a failed earlier attempt left undone.
//
// 200 { ok: true, reverted: number[] (edit ids stamped by this call),
//       republished: { [activityId]: status | "failed" } }
// 400 bad ids · 401 · 404 edit not on this activity · 409 crop a live split depends on · 500
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { getActivity, getEdit, listEdits, revertEditOnce, setHidden } from "@/lib/cleaning/load";
import { revertRefusal } from "@/lib/cleaning/plan";
import type { ActivityEditRow } from "@/lib/db";
import { bad, failure, parseId, republishAll, type Ctx } from "../../../cleaning/shared";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const active = async (activityId: number) => (await listEdits(activityId)).filter((e) => !e.revertedAt);

async function revertSplit(parentId: number, marker: ActivityEditRow) {
  if (marker.revertedAt) return { reverted: [], republished: {} };
  const childId = Number(marker.params.childId);
  const cropId = Number(marker.params.parentCropEditId);
  const reverted: number[] = [];
  // child first, marker last: a retry sees the marker still active and redoes the rest
  const child = Number.isInteger(childId) && childId > 0 ? await getActivity(childId) : null;
  if (child) await setHidden(child.id, true);
  if (Number.isInteger(cropId) && cropId > 0 && (await revertEditOnce(cropId))) reverted.push(cropId);
  if (await revertEditOnce(marker.id)) reverted.push(marker.id);
  const republished = await republishAll(child ? [parentId, child.id] : [parentId]);
  return { reverted, republished };
}

async function revertMerge(targetId: number, absorbedId: number, mergeEdit: ActivityEditRow | null) {
  const reverted: number[] = [];
  let republished: Record<number, string> = {};
  if (mergeEdit && !mergeEdit.revertedAt) {
    // the target stops including it before the absorbed one comes back, so
    // nothing is ever published twice
    if (await revertEditOnce(mergeEdit.id)) reverted.push(mergeEdit.id);
    republished = await republishAll([targetId]);
  } else {
    // already reverted: only finish the absorbed side, unless merged again since
    const again = (await active(targetId)).some((e) => e.kind === "merge" && Number(e.params.withActivityId) === absorbedId);
    if (again) return { reverted, republished };
  }
  const marker = (await active(absorbedId)).find((e) => e.kind === "merged-into" && Number(e.params.intoActivityId) === targetId);
  if (marker) {
    await setHidden(absorbedId, marker.params.wasHidden === true);
    if (await revertEditOnce(marker.id)) reverted.push(marker.id);
    republished = { ...republished, ...(await republishAll([absorbedId])) };
  }
  return { reverted, republished };
}

export async function POST(request: Request, { params }: Ctx<"id" | "editId">) {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  const p = await params;
  const id = parseId(p.id);
  const editId = parseId(p.editId);
  if (!id || !editId) return bad("bad id");
  try {
    const edit = await getEdit(editId);
    if (!edit || edit.activityId !== id) return bad("edit not found", 404);

    if (edit.kind === "split") return NextResponse.json({ ok: true, ...(await revertSplit(id, edit)) });

    if (edit.kind === "merge") {
      const absorbedId = Number(edit.params.withActivityId);
      return NextResponse.json({ ok: true, ...(await revertMerge(id, absorbedId, edit)) });
    }

    if (edit.kind === "merged-into") {
      const targetId = Number(edit.params.intoActivityId);
      const merge = (await active(targetId)).find((e) => e.kind === "merge" && Number(e.params.withActivityId) === id) ?? null;
      if (merge || !edit.revertedAt) return NextResponse.json({ ok: true, ...(await revertMerge(targetId, id, merge)) });
      return NextResponse.json({ ok: true, reverted: [], republished: {} });
    }

    if (edit.revertedAt) return NextResponse.json({ ok: true, reverted: [], republished: {} });
    const row = await getActivity(id);
    if (!row) return bad("not found", 404);
    const refusal = revertRefusal(edit, await active(id), { isSplitChild: await isLiveSplitChild(row.id, row.splitFromId) });
    if (refusal) return bad(refusal.error, refusal.status);
    const reverted = (await revertEditOnce(edit.id)) ? [edit.id] : [];
    return NextResponse.json({ ok: true, reverted, republished: await republishAll([id]) });
  } catch (error) {
    return failure("admin:cleaning:revert", error);
  }
}

// a child whose parent still carries the split marker for it
async function isLiveSplitChild(id: number, splitFromId: number | null): Promise<boolean> {
  if (!splitFromId) return false;
  return (await active(splitFromId)).some((e) => e.kind === "split" && Number(e.params.childId) === id);
}
