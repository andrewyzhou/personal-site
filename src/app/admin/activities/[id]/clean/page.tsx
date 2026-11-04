import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb, activities } from "@/lib/db";
import CleanActivity from "@/components/admin/cleaning/CleanActivity";
import { isAdminViewer } from "../../../require-admin";

export const dynamic = "force-dynamic";

// track cleaning: everything else loads client-side from the cleaning api
export default async function AdminCleanActivityPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdminViewer())) return null;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isInteger(id) || id <= 0) notFound();

  const rows = await getDb()
    .select({ id: activities.id, name: activities.name, sportType: activities.sportType, utcOffsetMin: activities.utcOffsetMin })
    .from(activities)
    .where(eq(activities.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) notFound();

  return (
    <div>
      <p style={{ marginBottom: "1rem" }}>
        <Link href={`/admin/activities/${row.id}`} className="font-sans text-gray text-sm link-highlight">
          ← edit activity
        </Link>
      </p>
      <CleanActivity id={row.id} name={row.name} sportType={row.sportType} utcOffsetMin={row.utcOffsetMin} />
    </div>
  );
}
