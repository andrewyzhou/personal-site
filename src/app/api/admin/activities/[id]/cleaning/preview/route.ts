// POST /api/admin/activities/[id]/cleaning/preview { edits: [{ kind, params }] }
// what republish would publish with the current active edits plus these
// (appended in order, so a proposed crop wins). writes nothing.
//   kinds: crop | cut | drop-points | no-gps | merge (0..50 edits, each validated)
//
// 200 { ok: true, preview: { polyline, cardPolyline, bounds,
//        stats: { distanceM, movingTimeS, elapsedTimeS, elevGainM, avgSpeedMs, maxSpeedMs, avgHr, maxHr,
//                 avgCadence, avgWatts, maxWatts, kilojoules, trimStartM, trimEndM, hrZonesS } } }
// 400 bad id / body / edit · 401 · 404 · 422 no track · 503 track unreadable · 500
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { getActivity, loadPublishContext, loadTrackForRow } from "@/lib/cleaning/load";
import { parseProposedEdits, pickStats } from "@/lib/cleaning/plan";
import { defaultDeps, publishTrack } from "@/lib/republish";
import { bad, effectiveEdits, failure, parseId, readJson, type Ctx } from "../shared";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request, { params }: Ctx) {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  const id = parseId((await params).id);
  if (!id) return bad("bad id");
  const body = await readJson(request);
  if (!body) return bad("invalid json body");
  const proposed = parseProposedEdits(body.edits);
  if (typeof proposed === "string") return bad(proposed);
  if (proposed.some((e) => e.kind === "merge" && e.params.withActivityId === id)) return bad("can't merge an activity into itself");
  try {
    const row = await getActivity(id);
    if (!row) return bad("not found", 404);
    const deps = defaultDeps();
    const load = await loadTrackForRow(row, deps);
    if (load.status === "no-track") return bad("no track stored for this activity", 422);
    if (load.status !== "ok") return bad("track is unreadable right now", 503);
    const edits = [...(await effectiveEdits(row)), ...proposed];
    const ctx = await loadPublishContext(row, load.track, edits, deps);
    if (ctx === "unavailable") return bad("a merged activity's track is unreadable right now", 503);
    const { columns } = publishTrack(load.track, edits, ctx);
    return NextResponse.json({
      ok: true,
      preview: { polyline: columns.polyline, cardPolyline: columns.cardPolyline, bounds: columns.bounds, stats: pickStats(columns) },
    });
  } catch (error) {
    return failure("admin:cleaning:preview", error);
  }
}
