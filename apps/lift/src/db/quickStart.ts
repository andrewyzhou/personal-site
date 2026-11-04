import { and, isNotNull, max, ne } from "drizzle-orm";
import { db } from "./client";
import { workouts } from "./schema";

/** template id -> latest startedAt of a workout started from it (discarded ones don't count) */
export function templateLastUsed(): Record<string, number> {
  const rows = db
    .select({ templateId: workouts.templateId, at: max(workouts.startedAt) })
    .from(workouts)
    .where(and(isNotNull(workouts.templateId), ne(workouts.status, "discarded")))
    .groupBy(workouts.templateId)
    .all();
  const out: Record<string, number> = {};
  for (const r of rows) if (r.templateId && r.at != null) out[r.templateId] = Number(r.at);
  return out;
}
