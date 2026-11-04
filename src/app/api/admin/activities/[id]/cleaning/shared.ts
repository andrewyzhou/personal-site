// shared bits for the cleaning admin routes (cleaning, edits, suggestions,
// split, merge): id parsing, active edits, and republish + cache refresh
import { revalidatePath } from "next/cache";
import { activeEdits, defaultDeps, republish, withLegacyTrim, type EditInput } from "@/lib/republish";
import { invalidateCache } from "@/lib/cache";
import { listEdits, loadTrackForRow, markStale } from "@/lib/cleaning/load";
import { boundaryRefusal, splitBounds, syntheticRefusal, withAnchor } from "@/lib/cleaning/plan";
import { bad } from "@/app/api/admin/privacy/http";
import type { ActivityRow } from "@/lib/db";
import { log } from "@/lib/log";

export { bad, readJson, parseId, failure } from "@/app/api/admin/privacy/http";

export type Ctx<P extends string = "id"> = { params: Promise<Record<P, string>> };

// active edits as republish sees them (legacy trim included)
export async function effectiveEdits(row: ActivityRow): Promise<EditInput[]> {
  return withLegacyTrim(row, activeEdits(await listEdits(row.id)));
}

// checks before a crop/cut/drop-points/no-gps is recorded: a readable, timed
// track, and nothing past a live split boundary. passes back the params
// anchored to the current canonical track
export async function guardCleaningEdit(
  row: ActivityRow,
  edit: { kind: string; params: Record<string, unknown> }
): Promise<{ ok: true; params: Record<string, unknown> } | { ok: false; response: Response }> {
  const load = await loadTrackForRow(row, defaultDeps());
  if (load.status === "no-track" || load.status === "not-found") return { ok: false, response: bad("no track stored for this activity — nothing to clean", 422) };
  if (load.status !== "ok") return { ok: false, response: bad("the original file can't be read right now — edit not applied", 503) };
  const synthetic = syntheticRefusal(load.track);
  if (synthetic) return { ok: false, response: bad(synthetic.error, synthetic.status) };
  const own = activeEdits(await listEdits(row.id));
  const parentEdits = row.splitFromId ? activeEdits(await listEdits(row.splitFromId)) : null;
  const refusal = boundaryRefusal(edit, splitBounds(row.id, own, parentEdits));
  if (refusal) return { ok: false, response: bad(refusal.error, refusal.status) };
  return { ok: true, params: withAnchor(edit.kind, edit.params, load.track.startEpochMs) };
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
