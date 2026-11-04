// shared bits for the cleaning admin routes (cleaning, edits, suggestions,
// split, merge): id parsing, active edits, and republish + cache refresh
import { revalidatePath } from "next/cache";
import { activeEdits, republish, withLegacyTrim, type EditInput } from "@/lib/republish";
import { invalidateCache } from "@/lib/cache";
import { listEdits, markStale } from "@/lib/cleaning/load";
import type { ActivityRow } from "@/lib/db";
import { log } from "@/lib/log";

export { bad, readJson, parseId, failure } from "@/app/api/admin/privacy/http";

export type Ctx<P extends string = "id"> = { params: Promise<Record<P, string>> };

// active edits as republish sees them (legacy trim included)
export async function effectiveEdits(row: ActivityRow): Promise<EditInput[]> {
  return withLegacyTrim(row, activeEdits(await listEdits(row.id)));
}

export async function refreshCaches(ids: number[]): Promise<void> {
  await invalidateCache("activities_list", "activities_latest");
  for (const id of new Set(ids)) revalidatePath(`/activities/${id}`);
}

// marks stale first so a failed republish is retried by the rebuild job; a
// failure is reported per id, the recorded edits stay (they're the intent)
export async function republishAll(ids: number[]): Promise<Record<number, string>> {
  const unique = [...new Set(ids)];
  await markStale(unique);
  const out: Record<number, string> = {};
  for (const id of unique) {
    try {
      out[id] = (await republish(id)).status;
    } catch (error) {
      log.error("admin:cleaning", `republish failed for ${id}`, error);
      out[id] = "failed";
    }
  }
  await refreshCaches(unique);
  return out;
}
