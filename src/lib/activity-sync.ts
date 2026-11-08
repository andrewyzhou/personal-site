// one activity sync across every source: the garmin personal api (when its
// key is set) first, so a new workout arrives with garmin's original, then
// intervals.icu. a source answering 429/5xx is skipped for this run and
// recorded; nothing is retried. everything lands in the sync log.
// server-only.

import { isGarminConfigured, pullGarminActivities, type GarminPullResult } from "./garmin";
import { isIntervalsConfigured, pullIntervalsActivities, type PullResult } from "./intervals";
import { syncEvent, UpstreamUnavailableError, withSyncRun, type SyncTrigger } from "./sync-log";

// the frequent pull looks this far back: new activities and recent renames
export const FREQUENT_LOOKBACK_DAYS = 3;

export type SourceOutcome = PullResult | GarminPullResult | { off: true } | { skipped: string } | { error: string };

export interface ActivitySyncResult {
  runId: string;
  dryRun: boolean;
  garmin: SourceOutcome;
  intervals: SourceOutcome;
  changed: boolean; // anything inserted, attached or renamed
}

const changedBy = (o: SourceOutcome) =>
  "inserted" in o && o.inserted + o.upgraded + o.updated > 0;

async function runSource(source: string, pull: () => Promise<PullResult | GarminPullResult>): Promise<SourceOutcome> {
  try {
    return await pull();
  } catch (error) {
    if (error instanceof UpstreamUnavailableError) {
      await syncEvent({ source, kind: "skip", detail: { reason: "upstream unavailable, skipped this run", status: error.status, message: error.message } });
      return { skipped: error.message };
    }
    await syncEvent({ source, kind: "error", detail: { message: (error as Error).message } });
    return { error: (error as Error).message };
  }
}

// the entry point for every trigger (the 10-minute poll, the daily cron, a
// telegram /sync, scripts). dryRun decides and logs (printed) but writes nothing.
export async function syncActivitiesNow({
  trigger,
  dryRun = false,
  days = FREQUENT_LOOKBACK_DAYS,
  metadataDays = FREQUENT_LOOKBACK_DAYS,
  sources = ["garmin", "intervals"],
}: {
  trigger: SyncTrigger;
  dryRun?: boolean;
  days?: number;
  metadataDays?: number;
  sources?: ("garmin" | "intervals")[];
}): Promise<ActivitySyncResult> {
  return withSyncRun({ trigger, source: "activities", dryRun }, async (run) => {
    const garmin: SourceOutcome =
      sources.includes("garmin") && isGarminConfigured()
        ? await runSource("garmin", () => pullGarminActivities({ days, metadataDays }))
        : { off: true };
    const intervals: SourceOutcome =
      sources.includes("intervals") && isIntervalsConfigured()
        ? await runSource("intervals", () => pullIntervalsActivities({ days, metadataDays }))
        : { off: true };
    return { runId: run.runId, dryRun: run.dryRun, garmin, intervals, changed: changedBy(garmin) || changedBy(intervals) };
  });
}
