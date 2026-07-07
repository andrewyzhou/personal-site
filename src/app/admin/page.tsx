import Link from "next/link";
import Image from "next/image";
import { desc } from "drizzle-orm";
import { getDb, activities } from "@/lib/db";
import { r2Usage } from "@/lib/r2";
import { formatMiles, formatClockDuration, sportIcon, DURATION_ONLY_TYPES } from "@/lib/activity-format";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";

export default async function AdminDashboard() {
  let recent: (typeof activities.$inferSelect)[] = [];
  try {
    recent = await getDb().select().from(activities).orderBy(desc(activities.startDateUtc)).limit(10);
  } catch (error) {
    log.error("admin:dashboard", "recent activities query failed", error);
  }

  let storageLine = "";
  try {
    const { totalBytes } = await r2Usage();
    storageLine = `r2 store: ${(totalBytes / 1_000_000).toFixed(0)} mb / 10 gb free`;
  } catch {
    storageLine = "r2 store: audit unavailable";
  }

  return (
    <div className="flex flex-col" style={{ gap: "12px" }}>
      <Link
        href="/admin/upload"
        className="card-bg rounded-lg font-sans text-off-white text-lg text-center block"
        style={{ padding: "20px" }}
      >
        + upload activity
      </Link>

      {recent.length > 0 && (
        <div style={{ marginTop: "1rem" }}>
          <p className="font-sans text-gray text-sm" style={{ marginBottom: "0.5rem" }}>
            recent
          </p>
          <div className="flex flex-col" style={{ gap: "0.4rem" }}>
            {recent.map((a) => (
              <Link
                key={a.id}
                href={`/admin/activities/${a.id}`}
                className="card-bg-hover rounded-lg flex items-center"
                style={{ padding: "0.5rem 0.75rem", gap: "0.6rem" }}
              >
                <Image src={`/icons/activities/${sportIcon(a.sportType)}.svg`} alt="" width={16} height={16} />
                <span className="font-sans text-off-white text-sm" style={{ flex: 1 }}>
                  {a.name}
                  {a.hidden ? <span className="text-gray italic"> · hidden</span> : null}
                </span>
                <span className="font-sans text-gray text-xs">
                  {DURATION_ONLY_TYPES.has(a.sportType) || a.distanceM < 100
                    ? formatClockDuration(a.elapsedTimeS)
                    : formatMiles(a.distanceM)}{" "}
                  · {a.localDate}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      <p className="font-sans text-gray text-xs" style={{ marginTop: "1rem" }}>
        {storageLine}
      </p>
    </div>
  );
}
