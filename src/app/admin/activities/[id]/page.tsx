import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb, activities } from "@/lib/db";
import EditActivity from "@/components/admin/EditActivity";
import RouteThumb from "@/components/RouteThumb";

export const dynamic = "force-dynamic";

export default async function AdminEditActivityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isInteger(id) || id <= 0) notFound();

  const rows = await getDb().select().from(activities).where(eq(activities.id, id)).limit(1);
  const row = rows[0];
  if (!row) notFound();

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
          hidden: row.hidden,
          trimStartM: row.trimStartM,
          trimEndM: row.trimEndM,
          hasOriginal: !!row.fitBlobPathname,
        }}
      />
    </div>
  );
}
