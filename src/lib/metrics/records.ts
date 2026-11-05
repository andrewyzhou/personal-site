// cross-activity metrics, pure: all-time bests, a fitness/fatigue trend from
// per-activity effort, and gear mileage. inputs are public activities only
// (callers pass published, non-hidden rows with their public metrics), so
// nothing here can surface a fogged stretch or hidden heart rate.

import type { ActivityMetrics, BestEffort, CurvePoint } from "./types";

export interface RecordInput {
  activityId: number;
  date: string; // local yyyy-mm-dd
  name: string;
  metrics: ActivityMetrics;
}

export interface EffortRecord extends BestEffort {
  activityId: number;
  date: string;
  name: string;
}

export interface CurveRecord extends CurvePoint {
  activityId: number;
  date: string;
  name: string;
}

// fastest time per best-effort distance, top n each, earliest wins a tie
export function bestEffortRecords(list: RecordInput[], topN = 3): Record<string, EffortRecord[]> {
  const by: Record<string, EffortRecord[]> = {};
  for (const a of list) {
    for (const e of a.metrics.bestEfforts) {
      (by[e.key] ??= []).push({ ...e, activityId: a.activityId, date: a.date, name: a.name });
    }
  }
  for (const k of Object.keys(by)) {
    by[k] = by[k].sort((x, y) => x.timeS - y.timeS || x.date.localeCompare(y.date) || x.activityId - y.activityId).slice(0, topN);
  }
  return by;
}

// best value per curve duration (power or speed), with the activity it came from
export function curveRecords(list: RecordInput[], which: "powerCurve" | "speedCurve"): CurveRecord[] {
  const best = new Map<number, CurveRecord>();
  for (const a of list) {
    for (const p of a.metrics[which] ?? []) {
      const cur = best.get(p.durS);
      if (!cur || p.value > cur.value || (p.value === cur.value && a.date < cur.date)) {
        best.set(p.durS, { ...p, activityId: a.activityId, date: a.date, name: a.name });
      }
    }
  }
  return [...best.values()].sort((x, y) => x.durS - y.durS);
}

// is this activity's effort an all-time best (rank 1) for any distance?
export function prKeysFor(activityId: number, records: Record<string, EffortRecord[]>): string[] {
  return Object.entries(records)
    .filter(([, rs]) => rs[0]?.activityId === activityId)
    .map(([k]) => k);
}

// ---------------------------------------------------------------- fitness

export interface FitnessDay {
  date: string;
  load: number; // summed effort that day
  fitness: number; // 42-day exponentially weighted load
  fatigue: number; // 7-day exponentially weighted load
  form: number; // fitness − fatigue (yesterday's, as the day starts)
}

const DAY_MS = 86_400_000;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const dayMs = (d: string) => Date.parse(`${d}T00:00:00Z`);

// daily series from the first effort through `until` (inclusive). days with
// no activity decay both curves. effort null (no hr / hr hidden) adds nothing.
export function fitnessSeries(
  efforts: { date: string; effort: number | null }[],
  until: string,
  fitnessDays = 42,
  fatigueDays = 7
): FitnessDay[] {
  const loads = new Map<string, number>();
  for (const e of efforts) {
    if (e.effort === null || !Number.isFinite(e.effort) || e.effort <= 0) continue;
    loads.set(e.date, (loads.get(e.date) ?? 0) + e.effort);
  }
  if (loads.size === 0) return [];
  const first = Math.min(...[...loads.keys()].map(dayMs));
  const last = dayMs(until);
  if (!Number.isFinite(first) || !Number.isFinite(last) || last < first) return [];
  const kf = 1 - Math.exp(-1 / fitnessDays);
  const ka = 1 - Math.exp(-1 / fatigueDays);
  const out: FitnessDay[] = [];
  let fit = 0;
  let fat = 0;
  for (let ms = first; ms <= last; ms += DAY_MS) {
    const date = isoDay(ms);
    const load = loads.get(date) ?? 0;
    const form = fit - fat;
    fit += (load - fit) * kf;
    fat += (load - fat) * ka;
    out.push({ date, load: r1(load), fitness: r1(fit), fatigue: r1(fat), form: r1(form) });
  }
  return out;
}

// ---------------------------------------------------------------- gear

export interface GearTotal {
  gear: string;
  distanceM: number;
  activities: number;
  firstDate: string;
  lastDate: string;
  alert: boolean; // past the replacement mileage for its kind
}

// shoes wear out around 300–500 mi; flag at 400 mi by default
export const SHOE_ALERT_M = 400 * 1609.344;
const FOOT = new Set(["Run", "TrailRun", "VirtualRun", "Walk", "Hike"]);

export function gearTotals(
  rows: { gear: string | null; distanceM: number; sportType: string; date: string }[],
  shoeAlertM = SHOE_ALERT_M
): GearTotal[] {
  const by = new Map<string, GearTotal & { foot: boolean }>();
  for (const r of rows) {
    const name = r.gear?.trim();
    if (!name) continue;
    const g = by.get(name) ?? { gear: name, distanceM: 0, activities: 0, firstDate: r.date, lastDate: r.date, alert: false, foot: false };
    g.distanceM += Number.isFinite(r.distanceM) ? Math.max(0, r.distanceM) : 0;
    g.activities += 1;
    if (r.date < g.firstDate) g.firstDate = r.date;
    if (r.date > g.lastDate) g.lastDate = r.date;
    if (FOOT.has(r.sportType)) g.foot = true;
    by.set(name, g);
  }
  return [...by.values()]
    .map(({ foot, ...g }) => ({ ...g, distanceM: r1(g.distanceM), alert: foot && g.distanceM >= shoeAlertM }))
    .sort((a, b) => b.lastDate.localeCompare(a.lastDate) || b.distanceM - a.distanceM);
}

function r1(v: number): number {
  return Math.round(v * 10) / 10;
}
