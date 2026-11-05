import ListeningAdmin, { type ListeningAdminData } from "@/components/admin/ListeningAdmin";
import { loadListeningOverview } from "@/lib/listening/admin-data";
import { isListeningConfigured } from "@/lib/listening/service";
import { isAdminViewer } from "../require-admin";

export const dynamic = "force-dynamic";

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export default async function AdminListeningPage() {
  if (!(await isAdminViewer())) return null;
  let data: ListeningAdminData;
  try {
    const o = await loadListeningOverview();
    data = {
      configured: isListeningConfigured(),
      migrated: o.migrated,
      error: null,
      state: o.state
        ? {
            cursorPlayedAt: iso(o.state.cursorPlayedAt),
            lastRunAt: iso(o.state.lastRunAt),
            lastRunStatus: o.state.lastRunStatus,
            lastError: o.state.lastError,
            lastSuccessAt: iso(o.state.lastSuccessAt),
            lastRunStats: o.state.lastRunStats,
          }
        : null,
      counts: o.counts,
      recent: o.recent,
      lastImport: o.lastImport,
    };
  } catch (error) {
    data = {
      configured: isListeningConfigured(),
      migrated: false,
      error: (error as Error).message,
      state: null,
      counts: null,
      recent: [],
      lastImport: null,
    };
  }
  return <ListeningAdmin data={data} />;
}
