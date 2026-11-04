// POST /api/admin/activities/[id]/split { atS }
// splits at atS seconds (canonical clock, rounded to whole seconds; strictly
// inside the current cleaned range). the second half is a new activity:
//   child  → parent metadata (name + " (2)", no external id, no description),
//            start = parent start + atS, dedupe key sha256(`${parent key}:split:${atS}`),
//            legacy fit_* columns, split_from_id = parent, route withheld until
//            republish; the parent's sources are linked to it too. edits: crop
//            { startS: atS, endS: end of the parent's crop window | null } + the
//            parent's trim
//   parent → crop { startS: null, endS: atS } (crops intersect, so its earlier
//            crops keep applying) + a 'split' marker { childId, atS, parentCropEditId }
// both crops carry anchorEpochMs. both are republished. safe to retry: an
// existing child with that dedupe key is reused and only missing steps run.
// undo = revert the split marker.
//
// 200 { ok: true, childId, parentCropEditId, markerEditId, reused: boolean,
//       republished: { [activityId]: status | "failed" } }
// 400 bad id / atS outside the range · 401 · 404 · 409 merged activity ·
// 422 no track / route-only track · 503 track unreadable · 500
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { insertActivity } from "@/lib/activities";
import {
  copySources,
  findActivityIdByDedupeKey,
  getActivity,
  insertEdit,
  listEdits,
  loadTrackForRow,
  setHidden,
} from "@/lib/cleaning/load";
import {
  atSInside,
  childValues,
  cleanedRange,
  currentCrop,
  findSplitCrop,
  latestOf,
  parseAtS,
  splitCrops,
  splitDedupeKey,
  splitRefusal,
  syntheticRefusal,
  withAnchor,
} from "@/lib/cleaning/plan";
import { PROCESSING_VERSION, defaultDeps } from "@/lib/republish";
import { bad, effectiveEdits, failure, parseId, readJson, republishAll, type Ctx } from "../cleaning/shared";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request, { params }: Ctx) {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  const id = parseId((await params).id);
  if (!id) return bad("bad id");
  const body = await readJson(request);
  if (!body) return bad("invalid json body");
  const atS = parseAtS(body.atS);
  if (atS === null) return bad("atS must be a number of seconds > 0");
  try {
    const row = await getActivity(id);
    if (!row) return bad("not found", 404);
    const edits = await effectiveEdits(row);
    const refusal = splitRefusal(edits);
    if (refusal) return bad(refusal.error, refusal.status);

    const existingChildId = await findActivityIdByDedupeKey(splitDedupeKey(row.dedupeKey, atS));
    const marker = existingChildId !== null
      ? edits.find((e) => e.kind === "split" && Number(e.params.childId) === existingChildId)
      : undefined;
    if (marker && existingChildId !== null) {
      // already split here: just make sure both are published
      return NextResponse.json({
        ok: true,
        childId: existingChildId,
        parentCropEditId: Number(marker.params.parentCropEditId),
        markerEditId: marker.id,
        reused: true,
        republished: await republishAll([id, existingChildId]),
      });
    }

    const load = await loadTrackForRow(row, defaultDeps());
    if (load.status === "no-track") return bad("no track stored for this activity", 422);
    if (load.status !== "ok") return bad("track is unreadable right now", 503);
    const synthetic = syntheticRefusal(load.track);
    if (synthetic) return bad(synthetic.error, synthetic.status);
    const anchor = load.track.startEpochMs;

    // an earlier attempt that died after cropping the parent left this crop
    const ourCrop = existingChildId !== null ? findSplitCrop(edits, atS) : null;
    if (!ourCrop) {
      const range = cleanedRange(load.track, edits);
      if (!atSInside(range, atS)) {
        return bad(range ? `atS must be strictly inside ${range.startS}–${range.endS} s` : "nothing left to split");
      }
    }
    const crops = splitCrops(currentCrop(edits, ourCrop?.id), atS);

    let childId: number;
    if (existingChildId !== null) {
      childId = existingChildId;
      // a re-split after an undo brings the hidden half back
      await setHidden(childId, row.hidden);
    } else {
      const inserted = await insertActivity(childValues(row, atS, PROCESSING_VERSION));
      if (inserted.id === null) return bad("could not create the split activity", 500);
      childId = inserted.id;
    }
    await copySources(id, childId);

    const childEdits = (await listEdits(childId)).filter((e) => !e.revertedAt);
    const childCrop = currentCrop(childEdits);
    if (!childCrop || childCrop.startS !== crops.child.startS || childCrop.endS !== crops.child.endS) {
      await insertEdit(childId, "crop", withAnchor("crop", crops.child, anchor), `split from #${id} at ${atS} s`);
    }
    const trim = latestOf(edits, "trim");
    if (trim && !latestOf(childEdits, "trim")) await insertEdit(childId, "trim", trim.params, `trim copied from #${id} at split`);
    // cleaning that falls in the second half keeps applying there (same clock)
    const childKeys = new Set(childEdits.map((e) => `${e.kind}:${JSON.stringify(e.params)}`));
    for (const e of edits) {
      if (!["cut", "drop-points", "no-gps"].includes(e.kind)) continue;
      if (e.kind === "cut" && Number(e.params.toS) <= atS) continue;
      if (childKeys.has(`${e.kind}:${JSON.stringify(e.params)}`)) continue;
      await insertEdit(childId, e.kind, e.params, `copied from #${id} at split`);
    }

    const parentCropEditId = ourCrop?.id ?? (await insertEdit(id, "crop", withAnchor("crop", crops.parent, anchor), `split at ${atS} s into #${childId}`));
    const markerEditId = await insertEdit(id, "split", { childId, atS, parentCropEditId }, `split into #${childId}`);

    const republished = await republishAll([id, childId]);
    return NextResponse.json({ ok: true, childId, parentCropEditId, markerEditId, reused: existingChildId !== null, republished });
  } catch (error) {
    return failure("admin:cleaning:split", error);
  }
}
