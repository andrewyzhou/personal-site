import { describe, it, expect } from "vitest";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "@/lib/db/schema";
import { candidateRecordingsQuery } from "@/lib/lift/link";

// a real drizzle instance over an unreachable url: only toSQL() is used, nothing hits the network
const db = drizzle(neon("postgresql://user:pass@127.0.0.1:1/none"), { schema });

describe("candidateRecordingsQuery", () => {
  it("only treats recordings claimed by live workouts as taken", () => {
    const { sql, params } = candidateRecordingsQuery(db, { id: "share-x", startedLocal: "2026-11-04T18:12" }).toSQL();
    const sub = sql.slice(sql.indexOf("not exists"));
    expect(sub).toMatch(/inner join "lift_workouts" on "lift_workouts"."id" = "lift_workout_activities"."workout_id"/);
    expect(sub).toContain('"lift_workouts"."deleted_at" is null');
    expect(sub).toContain('"lift_workout_activities"."workout_id" <> $');
    expect(params).toEqual(expect.arrayContaining(["2026-11-03", "2026-11-05", "share-x"]));
    // read-only against activities
    expect(sql).toMatch(/^select /);
  });
});
