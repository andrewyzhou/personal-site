// GET /api/admin/activities/[id]/cleaning — everything the clean page needs.
// admin only: the track here is the untouched, unfogged canonical track.
//
// 200 {
//   ok: true,
//   activity: { id, name, sportType, startDateUtc, utcOffsetMin, hidden },
//   trackStatus: "ok" | "no-track" | "unavailable",
//   track: { t, lat, lng, speed, hr, ele, dist } | null   // ≤ 3000 points, first/last + per-bucket speed extremes
//   totalPoints: number,                                   // samples before downsampling
//   startEpochMs: number | null,                           // t = 0 of the canonical clock
//   syntheticTime: boolean,                                // route-only track: no cleaning, split or merge
//   published: { polyline, cardPolyline, bounds, distanceM, movingTimeS, elapsedTimeS, elevGainM,
//                avgSpeedMs, maxSpeedMs, avgHr, maxHr, avgCadence, avgWatts, maxWatts, kilojoules,
//                trimStartM, trimEndM, hrZonesS },
//   rawStats: RawStats | null,
//   edits: [{ id, kind, params, note, createdAt, revertedAt }],             // all, oldest first
//   suggestions: [{ id, kind, confidence, edit, summary, range, status, editId, createdAt, decidedAt }],
//   mergeCandidates: [{ id, name, startDateUtc, distanceM, sportType }],    // not hidden, ±12 h
//   splitFromId: number | null,
//   children: [{ id, name, startDateUtc, hidden }],
// }
// 400 bad id · 401 · 404 not found · 500
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import {
  getActivity,
  listChildren,
  listEdits,
  listMergeCandidates,
  listSuggestions,
  loadTrackForRow,
} from "@/lib/cleaning/load";
import { editorTrack, pickStats } from "@/lib/cleaning/plan";
import { defaultDeps } from "@/lib/republish";
import { bad, failure, parseId, type Ctx } from "./shared";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request, { params }: Ctx) {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  const id = parseId((await params).id);
  if (!id) return bad("bad id");
  try {
    const row = await getActivity(id);
    if (!row) return bad("not found", 404);
    const [load, edits, suggestions, mergeCandidates, children] = await Promise.all([
      loadTrackForRow(row, defaultDeps()),
      listEdits(id),
      listSuggestions(id),
      listMergeCandidates(row),
      listChildren(id),
    ]);
    const track = load.status === "ok" ? load.track : null;
    return NextResponse.json({
      ok: true,
      activity: { id: row.id, name: row.name, sportType: row.sportType, startDateUtc: row.startDateUtc, utcOffsetMin: row.utcOffsetMin, hidden: row.hidden },
      trackStatus: load.status,
      track: track ? editorTrack(track) : null,
      totalPoints: track ? track.columns.t.length : 0,
      startEpochMs: track ? track.startEpochMs : null,
      syntheticTime: track ? track.syntheticTime : false,
      published: { polyline: row.polyline, cardPolyline: row.cardPolyline, bounds: row.bounds, ...pickStats(row) },
      rawStats: row.rawStats ?? null,
      edits: edits.map((e) => ({ id: e.id, kind: e.kind, params: e.params, note: e.note, createdAt: e.createdAt, revertedAt: e.revertedAt })),
      suggestions: suggestions.map((s) => ({
        id: s.id, kind: s.kind, confidence: s.confidence, edit: s.edit, summary: s.summary, range: s.range,
        status: s.status, editId: s.editId, createdAt: s.createdAt, decidedAt: s.decidedAt,
      })),
      mergeCandidates,
      splitFromId: row.splitFromId ?? null,
      children,
    });
  } catch (error) {
    return failure("admin:cleaning", error);
  }
}
