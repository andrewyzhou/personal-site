// every request the clean page makes, in one place so field names are easy to
// adjust against the server

import type { ActivitySettingsShape, Bounds, EditRow, SuggestionRow } from "@/lib/cleaning/ui-format";

export interface CleaningTrack {
  t: number[];
  lat: (number | null)[];
  lng: (number | null)[];
  speed: (number | null)[];
  hr: (number | null)[];
  ele: (number | null)[];
  dist: (number | null)[];
}

export interface PublishedStats {
  distanceM: number | null;
  movingTimeS: number | null;
  elapsedTimeS: number | null;
  elevGainM: number | null;
  avgSpeedMs: number | null;
  avgHr: number | null;
  maxHr: number | null;
  hrZonesS: number[] | null;
}

export interface Published extends PublishedStats {
  polyline: string | null;
  cardPolyline: string | null;
  bounds: Bounds | null;
}

export interface RawStats extends Omit<PublishedStats, "hrZonesS"> {
  maxSpeedMs: number | null;
}

export interface MergeCandidate {
  id: number;
  name: string;
  startDateUtc: string;
  distanceM: number | null;
  sportType: string;
}

export type TrackStatus = "ok" | "no-track" | "unavailable";

export interface CleaningData {
  trackStatus: TrackStatus;
  track: CleaningTrack | null;
  startEpochMs: number;
  syntheticTime: boolean; // route-only track: nothing time-based can be edited
  published: Published;
  rawStats: RawStats | null;
  edits: EditRow[];
  suggestions: SuggestionRow[];
  mergeCandidates: MergeCandidate[];
  splitFromId: number | null;
  children: { id: number; name: string }[];
}

export interface ProposedEdit {
  kind: string;
  params: Record<string, unknown>;
}

export interface Preview {
  polyline: string | null;
  cardPolyline: string | null;
  bounds: Bounds | null;
  stats: PublishedStats;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function call(url: string, method: "GET" | "POST", body?: unknown): Promise<any> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.ok) throw new Error(json?.error ?? `request failed (${res.status})`);
  return json;
}

const base = (id: number) => `/api/admin/activities/${id}`;

export async function getCleaning(id: number): Promise<CleaningData> {
  const j = await call(`${base(id)}/cleaning`, "GET");
  return {
    trackStatus: j.trackStatus === "ok" || j.trackStatus === "unavailable" ? j.trackStatus : "no-track",
    track: j.track ?? null,
    startEpochMs: Number(j.startEpochMs) || 0,
    syntheticTime: j.syntheticTime === true,
    published: j.published ?? { polyline: null, cardPolyline: null, bounds: null, distanceM: null, movingTimeS: null, elapsedTimeS: null, elevGainM: null, avgSpeedMs: null, avgHr: null, maxHr: null, hrZonesS: null },
    rawStats: j.rawStats ?? null,
    edits: j.edits ?? [],
    suggestions: j.suggestions ?? [],
    mergeCandidates: j.mergeCandidates ?? [],
    splitFromId: j.splitFromId ?? null,
    children: j.children ?? [],
  };
}

export async function previewEdits(id: number, edits: ProposedEdit[]): Promise<Preview> {
  const j = await call(`${base(id)}/cleaning/preview`, "POST", { edits });
  return j.preview;
}

export async function createEdit(id: number, edit: ProposedEdit, note?: string): Promise<number> {
  const j = await call(`${base(id)}/edits`, "POST", { kind: edit.kind, params: edit.params, ...(note ? { note } : {}) });
  return j.editId;
}

export async function revertEdit(id: number, editId: number): Promise<void> {
  await call(`${base(id)}/edits/${editId}/revert`, "POST", {});
}

export async function actOnSuggestion(id: number, sid: number, action: "accept" | "dismiss"): Promise<void> {
  await call(`${base(id)}/suggestions/${sid}`, "POST", { action });
}

export async function splitActivity(id: number, atS: number): Promise<number> {
  const j = await call(`${base(id)}/split`, "POST", { atS });
  return j.childId;
}

export async function mergeActivity(id: number, otherId: number): Promise<number> {
  const j = await call(`${base(id)}/merge`, "POST", { otherId });
  return j.targetId;
}

export async function getActivitySettings(): Promise<ActivitySettingsShape> {
  const j = await call("/api/admin/activity-settings", "GET");
  return j.settings;
}

export async function saveActivitySettings(settings: ActivitySettingsShape): Promise<ActivitySettingsShape> {
  const j = await call("/api/admin/activity-settings", "POST", settings);
  return j.settings;
}
