import { NextResponse } from "next/server";
import { asc, eq, and } from "drizzle-orm";
import { getDb, activities, activityPhotos } from "@/lib/db";
import { isPublic, publicActivityDetail } from "@/lib/public-activity";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";

// per-id detail: calendar fields + route polylines + fog + photos, all via the
// public serializer. feeds the calendar detail card's lazy enhancement and
// anything needing the route.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ activity: null }, { status: 404 });
  }

  try {
    const db = getDb();
    const rows = await db
      .select()
      .from(activities)
      .where(and(eq(activities.id, id), eq(activities.hidden, false)))
      .limit(1);
    const row = rows[0];
    if (!row || !isPublic(row)) {
      return NextResponse.json({ activity: null }, { status: 404 });
    }

    // public columns only: the exif time/gps (taken_at, gps_*) never leave the db
    const photos = await db
      .select({
        blobUrl: activityPhotos.blobUrl,
        width: activityPhotos.width,
        height: activityPhotos.height,
        caption: activityPhotos.caption,
        pinLat: activityPhotos.pinLat,
        pinLng: activityPhotos.pinLng,
      })
      .from(activityPhotos)
      .where(eq(activityPhotos.activityId, id))
      .orderBy(asc(activityPhotos.position));

    return NextResponse.json({ activity: publicActivityDetail(row, photos) });
  } catch (error) {
    log.error("api:activities/[id]", `fetch failed for ${id}`, error);
    return NextResponse.json({ activity: null }, { status: 500 });
  }
}
