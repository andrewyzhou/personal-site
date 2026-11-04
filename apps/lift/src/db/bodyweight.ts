import { desc, eq, inArray } from "drizzle-orm";
import { randomUUID } from "expo-crypto";
import type { WeightUnit } from "lift-core";
import { db } from "./client";
import { notify } from "./events";
import { writeOutbox } from "./outbox";
import { bodyweights, kv, type BodyweightRow } from "./schema";
import { parseUnit } from "../lib/bodyweight";

// "unit" is the agreed key; "default_unit" is what the logger's settings write
const UNIT_KEYS = ["unit", "default_unit"];

/** the user's unit from kv when one is set, else lb */
export function getPreferredUnit(): WeightUnit {
  const rows = db.select().from(kv).where(inArray(kv.key, UNIT_KEYS)).all();
  const hit = UNIT_KEYS.map((k) => rows.find((r) => r.key === k)).find((r) => r);
  return parseUnit(hit?.value);
}

/** newest first */
export function listBodyweights(): BodyweightRow[] {
  return db.select().from(bodyweights).orderBy(desc(bodyweights.measuredAt)).all();
}

export interface NewBodyweight {
  weight: number;
  unit: WeightUnit;
  measuredAt?: number;
  note?: string | null;
}

export function addBodyweight(input: NewBodyweight, now = Date.now()): BodyweightRow {
  const row = db.transaction((tx) => {
    const inserted = tx
      .insert(bodyweights)
      .values({
        id: randomUUID(),
        measuredAt: input.measuredAt ?? now,
        weight: input.weight,
        unit: input.unit,
        note: input.note?.trim() ? input.note.trim() : null,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    writeOutbox(tx, "bodyweight", inserted.id, "insert", inserted);
    return inserted;
  });
  notify();
  return row;
}

export function deleteBodyweight(id: string): void {
  db.transaction((tx) => {
    const gone = tx.delete(bodyweights).where(eq(bodyweights.id, id)).returning({ id: bodyweights.id }).get();
    if (gone) writeOutbox(tx, "bodyweight", id, "delete", { id });
  });
  notify();
}
