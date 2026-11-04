// detector output shared by detection, republish (persistence + auto-apply)
// and the admin api/ui

export type SuggestionKind = "crop-head" | "crop-tail" | "cut-vehicle" | "drop-spikes" | "no-gps" | "idle";

export interface Suggestion {
  kind: SuggestionKind;
  confidence: number; // 0..1
  // the activity_edits row accepting it creates (null: information only, e.g. idle stretches)
  edit: { kind: string; params: Record<string, unknown> } | null;
  summary: string; // short admin-facing sentence, e.g. "car ride 12:40–13:05 (31 km/h)"
  range: { fromS: number; toS: number } | null; // on the canonical track clock
}

// bump when detection changes: suggestions are stored per detector version
export const DETECTOR_VERSION = 1;
