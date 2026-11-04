// privacy settings: insert-only rows in privacy_settings, newest wins. the
// pure helpers here are what republish applies.

import { desc } from "drizzle-orm";
import { getDb, privacySettings, type PrivacySettings } from "../db";
import { DEFAULT_PRIVACY_TRIM_M } from "../activities";

export const DEFAULT_PRIVACY_SETTINGS: PrivacySettings = {
  // visible-only: total minus visible would otherwise measure the hidden path
  distance: { mode: "visible-only", roundToM: 100 },
  coarsenStartMin: 0,
  defaultTrimM: DEFAULT_PRIVACY_TRIM_M,
};

const DISTANCE_MODES = ["include-rounded", "include-exact", "visible-only"] as const;
export const COARSEN_OPTIONS = [0, 5, 15, 30, 60] as const;

const num = (v: unknown, lo: number, hi: number, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : fallback;

// anything stored or posted → a complete, valid settings object
export function normalizeSettings(raw: unknown): PrivacySettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = (r.distance && typeof r.distance === "object" ? r.distance : {}) as Record<string, unknown>;
  const mode = DISTANCE_MODES.includes(d.mode as (typeof DISTANCE_MODES)[number])
    ? (d.mode as PrivacySettings["distance"]["mode"])
    : DEFAULT_PRIVACY_SETTINGS.distance.mode;
  const coarsen = (COARSEN_OPTIONS as readonly number[]).includes(r.coarsenStartMin as number)
    ? (r.coarsenStartMin as number)
    : DEFAULT_PRIVACY_SETTINGS.coarsenStartMin;
  return {
    distance: { mode, roundToM: num(d.roundToM, 10, 5000, DEFAULT_PRIVACY_SETTINGS.distance.roundToM) },
    coarsenStartMin: coarsen,
    defaultTrimM: num(r.defaultTrimM, 0, 5000, DEFAULT_PRIVACY_SETTINGS.defaultTrimM),
  };
}

export async function loadPrivacySettings(): Promise<PrivacySettings> {
  const rows = await getDb()
    .select({ settings: privacySettings.settings })
    .from(privacySettings)
    .orderBy(desc(privacySettings.id))
    .limit(1);
  return normalizeSettings(rows[0]?.settings ?? null);
}

// published distance of an activity that had fog (unfogged ones stay exact)
export function publishedDistance(
  totalM: number,
  visibleM: number,
  fogged: boolean,
  policy: PrivacySettings["distance"]
): number {
  if (!fogged) return totalM;
  if (policy.mode === "include-exact") return totalM;
  if (policy.mode === "visible-only") return visibleM;
  return Math.round(totalM / policy.roundToM) * policy.roundToM;
}

// floor the start to the coarsening step (whole minutes since the epoch, so
// the result is independent of the local offset for steps dividing an hour)
export function coarsenStart(startUtc: Date, stepMin: number): Date {
  if (!stepMin) return new Date(startUtc.getTime());
  const step = stepMin * 60000;
  return new Date(Math.floor(startUtc.getTime() / step) * step);
}
