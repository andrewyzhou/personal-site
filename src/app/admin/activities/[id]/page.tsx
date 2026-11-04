import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import { getDb, activities, activityPhotos, activitySources } from "@/lib/db";
import { visibilityOf } from "@/lib/public-activity";
import EditActivity from "@/components/admin/EditActivity";
import RouteThumb from "@/components/RouteThumb";
import { isAdminViewer } from "../../require-admin";

export const dynamic = "force-dynamic";

export default async function AdminEditActivityPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdminViewer())) return null;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isInteger(id) || id <= 0) notFound();

  const db = getDb();
  const rows = await db.select().from(activities).where(eq(activities.id, id)).limit(1);
  const row = rows[0];
  if (!row) notFound();

  // public columns only: the private exif never reaches the browser
  const photos = await db
    .select({
      pathname: activityPhotos.blobPathname,
      url: activityPhotos.blobUrl,
      width: activityPhotos.width,
      height: activityPhotos.height,
      caption: activityPhotos.caption,
    })
    .from(activityPhotos)
    .where(eq(activityPhotos.activityId, id))
    .orderBy(asc(activityPhotos.position));

  // trim is editable whenever republish has a track to rebuild from
  const trackSources = await db
    .select({ id: activitySources.id })
    .from(activitySources)
    .where(and(eq(activitySources.activityId, id), inArray(activitySources.kind, ["device-file", "strava-streams"]), isNotNull(activitySources.rawSha256)))
    .limit(1);

  return (
    <div>
      <p style={{ marginBottom: "1rem" }}>
        <Link href="/admin" className="font-sans text-gray text-sm link-highlight">
          ← dashboard
        </Link>
      </p>
      {row.cardPolyline && (
        <div className="card-bg rounded-lg flex justify-center" style={{ padding: "1rem", marginBottom: "1rem" }}>
          <RouteThumb polyline={row.cardPolyline} height={100} />
        </div>
      )}
      <EditActivity
        id={row.id}
        initial={{
          name: row.name,
          sportType: row.sportType,
          gear: row.gear,
          description: row.description,
          visibility: visibilityOf(row),
          hrHidden: row.hrHidden,
          trimStartM: row.trimStartM,
          trimEndM: row.trimEndM,
          hasOriginal: !!row.fitBlobPathname || trackSources.length > 0,
          utcOffsetMin: row.utcOffsetMin,
          photos,
        }}
      />
    </div>
  );
}
