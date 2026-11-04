import { describe, it, expect, vi, beforeEach } from "vitest";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "@/lib/db/schema";

const { recompute, state } = vi.hoisted(() => ({ recompute: vi.fn(), state: { db: null as unknown } }));

vi.mock("@/lib/db", async (orig) => ({
  ...(await orig<typeof import("@/lib/db")>()),
  getDb: () => state.db,
}));
vi.mock("@/lib/lift/sync/aggregates", () => ({
  recomputeWorkoutAggregates: (...a: unknown[]) => recompute(...a),
}));

import { pushMutations } from "@/lib/lift/sync/push";

const db = drizzle(neon("postgresql://user:pass@127.0.0.1:1/none"), { schema });
type Sqlable = { toSQL(): { sql: string; params: unknown[] } };

const T = Date.UTC(2026, 10, 4, 2, 12);
const workout = { id: "w1", title: "Push", startedAt: T, endedAt: null, utcOffsetMin: -480, status: "active", templateId: null, notes: null, createdAt: T, updatedAt: T };
const raw = (seq: number, over: Record<string, unknown> = {}) => ({ seq, entity: "workout", op: "insert", id: "w1", payload: workout, at: T, ...over });

const batch = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  const fake = Object.create(db);
  fake.batch = batch;
  state.db = fake;
  recompute.mockResolvedValue(1);
});

describe("pushMutations", () => {
  it("looks up state in one batch, writes in one batch, then recomputes aggregates", async () => {
    // seq 1 was already applied on an earlier push
    batch.mockResolvedValueOnce([[{ seq: 1 }], [], [], [], [], [], []]).mockResolvedValueOnce([]);
    const res = await pushMutations("device-abc123", [
      { seq: 1, raw: raw(1) },
      { seq: 2, raw: raw(2, { op: "update" }) },
      { seq: 3, raw: raw(3, { entity: "nope" }) },
    ]);
    expect(res).toEqual({ ok: true, appliedThrough: 3, applied: 1, skipped: 1, rejected: [{ seq: 3, reason: "unknown entity" }] });
    expect(batch).toHaveBeenCalledTimes(2);
    expect(batch.mock.calls[0][0]).toHaveLength(7);
    const writes = (batch.mock.calls[1][0] as Sqlable[]).map((q) => q.toSQL().sql);
    expect(writes).toHaveLength(2);
    expect(writes[0]).toMatch(/^insert into "lift_workouts"/);
    expect(writes[1]).toMatch(/^insert into "lift_sync_log"/);
    expect(recompute).toHaveBeenCalledWith(state.db, ["w1"], []);
  });

  it("propagates a failed write batch so the route can 500 (nothing applied)", async () => {
    batch.mockResolvedValueOnce([[], [], [], [], [], [], []]).mockRejectedValueOnce(new Error("fk violation"));
    await expect(pushMutations("device-abc123", [{ seq: 5, raw: raw(5) }])).rejects.toThrow("fk violation");
    expect(recompute).not.toHaveBeenCalled();
  });

  it("still answers when only the aggregate recompute fails", async () => {
    batch.mockResolvedValueOnce([[], [], [], [], [], [], []]).mockResolvedValueOnce([]);
    recompute.mockRejectedValueOnce(new Error("timeout"));
    const res = await pushMutations("device-abc123", [{ seq: 5, raw: raw(5) }]);
    expect(res).toMatchObject({ applied: 1, appliedThrough: 5 });
  });

  it("does no io for an empty push", async () => {
    expect(await pushMutations("device-abc123", [])).toEqual({ ok: true, appliedThrough: 0, applied: 0, skipped: 0, rejected: [] });
    expect(batch).not.toHaveBeenCalled();
  });
});
