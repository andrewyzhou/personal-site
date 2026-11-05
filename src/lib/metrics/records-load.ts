// server-only: cross-activity records for the public records page. public
// activities only; each row's metrics go through publicMetrics, so hide hr
// keeps its effort out of the fitness trend too. a read failure (table not
// migrated yet) gives empty records rather than failing the page.

import { and, eq } from "drizzle-orm";
import { getDb, activities, activityMetrics } from "../db";
import { publicMetrics } from "../public-activity";
import { log } from "../log";
import { liveReplayEnabled } from "../replay/live";
import {
  bestEffortRecords,
  curveRecords,
  fitnessSeries,
  gearTotals,
  type CurveRecord,
  type EffortRecord,
  type FitnessDay,
  type GearTotal,
  type RecordInput,
} from "./records";

export interface PublicRecords {
  efforts: Record<string, EffortRecord[]>;
  powerCurve: CurveRecord[];
  speedCurve: CurveRecord[];
  fitness: FitnessDay[]; // last 180 days
  gear: GearTotal[];
}

export const EMPTY_RECORDS: PublicRecords = { efforts: {}, powerCurve: [], speedCurve: [], fitness: [], gear: [] };

export async function loadPublicRecords(today: string): Promise<PublicRecords> {
  const db = getDb();
  let gear: GearTotal[] = [];
  try {
    const rows = await db
      .select({ gear: activities.gear, distanceM: activities.distanceM, sportType: activities.sportType, date: activities.localDate })
      .from(activities)
      .where(eq(activities.hidden, false));
    gear = gearTotals(rows);
  } catch (error) {
    log.error("metrics:records", "gear read failed", error);
  }

  let list: RecordInput[] = [];
  try {
    const rows = await db
      .select({
        id: activities.id,
        date: activities.localDate,
        name: activities.name,
        hidden: activities.hidden,
        hrHidden: activities.hrHidden,
        data: activityMetrics.data,
      })
      .from(activityMetrics)
      .innerJoin(activities, eq(activities.id, activityMetrics.activityId))
      .where(and(eq(activities.hidden, false)));
    list = rows.flatMap((r) => {
      const m = publicMetrics(r, r.data);
      return m ? [{ activityId: r.id, date: r.date, name: r.name, metrics: m }] : [];
    });
  } catch (error) {
    // dev against a db without the table: expected, not worth an error overlay
    if (!liveReplayEnabled()) log.error("metrics:records", "metrics read failed", error);
    return { ...EMPTY_RECORDS, gear };
  }

  const series = fitnessSeries(list.map((a) => ({ date: a.date, effort: a.metrics.effort })), today);
  return {
    efforts: bestEffortRecords(list),
    powerCurve: curveRecords(list, "powerCurve"),
    speedCurve: curveRecords(list, "speedCurve"),
    fitness: series.slice(-180),
    gear,
  };
}
