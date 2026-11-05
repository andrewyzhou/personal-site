// replay computed on request through the same publish pipeline republish uses
// (cleaning, trim, zones). read-only; used only when REPLAY_LIVE_FALLBACK=1
// (local development against a database whose replays aren't built yet).
// server-only.

import { activeEdits, defaultDeps, publishTrack, withLegacyTrim } from "../republish";
import { loadPublishContext, loadTrackForRow } from "../cleaning/load";
import type { ActivityRow } from "../db/schema";
import type { ReplayData } from "./build";

export function liveReplayEnabled(): boolean {
  return process.env.REPLAY_LIVE_FALLBACK === "1" && process.env.NODE_ENV !== "production";
}

export async function liveReplay(row: ActivityRow): Promise<ReplayData | null> {
  const deps = defaultDeps();
  const load = await loadTrackForRow(row, deps);
  if (load.status !== "ok") return null;
  const edits = withLegacyTrim(row, activeEdits(await deps.loadEdits(row.id)));
  const ctx = await loadPublishContext(row, load.track, edits, deps);
  if (ctx === "unavailable") return null;
  return publishTrack(load.track, edits, ctx).replay;
}
