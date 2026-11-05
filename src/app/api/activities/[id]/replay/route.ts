import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb, activities, activityReplays } from "@/lib/db";
import { isPublic } from "@/lib/public-activity";
import { publicReplay, type ReplayData } from "@/lib/replay/build";
import { liveReplay, liveReplayEnabled } from "@/lib/replay/live";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";

// GET /api/activities/[id]/replay → { replay: ReplayData } | { replay: null } (404)
// the published track with time, for the map replay. built by republish from
// the same points as the public route (post-cleaning, trim and fog), so it
// carries nothing the route doesn't. private and map-hidden activities have
// none; heart rate is removed when the activity hides it.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ replay: null }, { status: 404 });

  try {
    const db = getDb();
    const rows = await db
      .select({ hidden: activities.hidden, mapHidden: activities.mapHidden, hrHidden: activities.hrHidden })
      .from(activities)
      .where(and(eq(activities.id, id), eq(activities.hidden, false)))
      .limit(1);
    const row = rows[0];
    if (!row || !isPublic(row) || row.mapHidden) return NextResponse.json({ replay: null }, { status: 404 });

    let data: ReplayData | null = null;
    try {
      const replays = await db
        .select({ data: activityReplays.data })
        .from(activityReplays)
        .where(eq(activityReplays.activityId, id))
        .limit(1);
      data = replays[0]?.data ?? null;
    } catch (error) {
      if (!liveReplayEnabled()) throw error;
    }
    if (!data && liveReplayEnabled()) {
      const full = await db.select().from(activities).where(eq(activities.id, id)).limit(1);
      if (full[0]) data = await liveReplay(full[0]);
    }
    if (!data) return NextResponse.json({ replay: null }, { status: 404 });

    return NextResponse.json(
      { replay: publicReplay(data, row.hrHidden) },
      // no shared caching: a visibility change must take effect immediately
      { headers: { "Cache-Control": "private, max-age=60" } }
    );
  } catch (error) {
    log.error("api:activities/[id]/replay", `fetch failed for ${id}`, error);
    return NextResponse.json({ replay: null }, { status: 500 });
  }
}
