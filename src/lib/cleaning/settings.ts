// cleaning/metrics settings. fixed defaults: there is no settings table or
// admin form, so every activity publishes with these.

import type { ActivitySettings } from "../db";

export const DEFAULT_ACTIVITY_SETTINGS: ActivitySettings = {
  autoApply: { enabled: false, minConfidence: 0.9 },
  hrMaxBpm: 190,
  hrZonePcts: [0.6, 0.7, 0.8, 0.9],
  hrRestBpm: null,
  thresholdPaceSPerKm: null,
};
