// cleaning/metrics settings: insert-only rows in activity_settings, newest wins

import { desc } from "drizzle-orm";
import { getDb, activitySettings, type ActivitySettings } from "../db";

export const DEFAULT_ACTIVITY_SETTINGS: ActivitySettings = {
  autoApply: { enabled: false, minConfidence: 0.9 },
  hrMaxBpm: 190,
  hrZonePcts: [0.6, 0.7, 0.8, 0.9],
};

const num = (v: unknown, lo: number, hi: number, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : fallback;

export function normalizeActivitySettings(raw: unknown): ActivitySettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const a = (r.autoApply && typeof r.autoApply === "object" ? r.autoApply : {}) as Record<string, unknown>;
  const pcts = Array.isArray(r.hrZonePcts) && r.hrZonePcts.length === 4 && r.hrZonePcts.every((p, i, arr) =>
    typeof p === "number" && p > 0.3 && p < 1 && (i === 0 || p > (arr[i - 1] as number)))
    ? (r.hrZonePcts as number[])
    : DEFAULT_ACTIVITY_SETTINGS.hrZonePcts;
  return {
    autoApply: {
      enabled: typeof a.enabled === "boolean" ? a.enabled : DEFAULT_ACTIVITY_SETTINGS.autoApply.enabled,
      minConfidence: num(a.minConfidence, 0.5, 1, DEFAULT_ACTIVITY_SETTINGS.autoApply.minConfidence),
    },
    hrMaxBpm: num(r.hrMaxBpm, 120, 230, DEFAULT_ACTIVITY_SETTINGS.hrMaxBpm),
    hrZonePcts: pcts,
  };
}

export async function loadActivitySettings(): Promise<ActivitySettings> {
  const rows = await getDb()
    .select({ settings: activitySettings.settings })
    .from(activitySettings)
    .orderBy(desc(activitySettings.id))
    .limit(1);
  return normalizeActivitySettings(rows[0]?.settings ?? null);
}
