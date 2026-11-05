// server-only: an activity's stored metrics for its public page. a read
// failure (e.g. the table not migrated yet) renders the page without metrics
// rather than failing it. with REPLAY_LIVE_FALLBACK=1 in development, metrics
// missing from the db are computed on request through the publish pipeline.

import { eq } from "drizzle-orm";
import { getDb, activityMetrics, type ActivityRow } from "../db";
import { activeEdits, defaultDeps, publishTrack, withLegacyTrim } from "../republish";
import { loadPublishContext, loadTrackForRow } from "../cleaning/load";
import { liveReplayEnabled } from "../replay/live";
import { publicMetrics } from "../public-activity";
import { log } from "../log";
import type { ActivityMetrics } from "./types";

async function liveMetrics(row: ActivityRow): Promise<ActivityMetrics | null> {
  const deps = defaultDeps();
  const load = await loadTrackForRow(row, deps);
  if (load.status !== "ok") return null;
  const edits = withLegacyTrim(row, activeEdits(await deps.loadEdits(row.id)));
  const ctx = await loadPublishContext(row, load.track, edits, deps);
  if (ctx === "unavailable") return null;
  return publishTrack(load.track, edits, ctx).metrics;
}

export async function loadPublicMetrics(row: ActivityRow): Promise<ActivityMetrics | null> {
  let data: ActivityMetrics | null = null;
  try {
    const rows = await getDb()
      .select({ data: activityMetrics.data })
      .from(activityMetrics)
      .where(eq(activityMetrics.activityId, row.id))
      .limit(1);
    data = rows[0]?.data ?? null;
  } catch (error) {
    if (!liveReplayEnabled()) log.error("metrics:load", `read failed for ${row.id}`, error);
  }
  if (!data && liveReplayEnabled()) {
    try {
      data = await liveMetrics(row);
    } catch (error) {
      log.error("metrics:load", `live metrics failed for ${row.id}`, error);
    }
  }
  return publicMetrics(row, data);
}
