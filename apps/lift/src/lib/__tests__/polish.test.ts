/// <reference types="node" />
// theme colors, the monotonic clock, home quick-start ordering, the restore
// offer, body shading, and sync overlap/ack safety.

import { DatabaseSync } from "node:sqlite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { describe, expect, it, vi } from "vitest";
import { oklchGrayToHex, overlay } from "../color";
import { bumpedAt, stamp } from "../clock";
import { recentTemplates } from "../quickStart";
import { shouldOfferRestore, type RestoreOfferState } from "../sync/restoreOffer";
import { intensityOf, topRegions } from "../bodyLoad";
import { singleFlight } from "../sync/singleFlight";
import { planAck, type AckPlan, type OutboxLike } from "../sync/mutations";
import { pushAll, type FetchLike } from "../sync/push";
import { pendingMigrations } from "../../db/migrations";
import { templates } from "../../db/schema";
import { dark, light } from "../palette";

describe("oklch -> hex", () => {
  it("maps the ends and the site's grays", () => {
    expect(oklchGrayToHex(0)).toBe("#000000");
    expect(oklchGrayToHex(100)).toBe("#ffffff");
    // reference values from a css color converter
    expect(oklchGrayToHex(17.3)).toBe("#101010");
    expect(oklchGrayToHex(94.9)).toBe("#eeeeee");
    expect(oklchGrayToHex(84.5)).toBe("#cccccc");
  });
  it("is monotonic in lightness", () => {
    const vals = [10, 20, 30, 45, 60, 75, 90].map((l) => parseInt(oklchGrayToHex(l).slice(1, 3), 16));
    expect(vals).toEqual([...vals].sort((a, b) => a - b));
  });
  it("flattens an overlay onto its background", () => {
    expect(overlay("#ffffff", "#000000", 0.5)).toBe("#808080");
    expect(overlay("#eeeeee", "#101010", 0)).toBe("#101010");
    expect(overlay("#eeeeee", "#101010", 1)).toBe("#eeeeee");
  });
  it("themes are inverses with the primary text as the accent", () => {
    expect(dark.bg).toBe(light.strong);
    expect(light.bg).toBe(dark.strong);
    for (const p of [dark, light]) {
      expect(p.accent).toBe(p.strong);
      expect(p.accentText).toBe(p.bg);
      expect(p.steps).toHaveLength(5);
      for (const v of [p.bg, p.card, p.text, p.muted, p.border, p.input, p.done, ...p.steps]) {
        expect(v).toMatch(/^#([0-9a-f]{2})\1\1$/);
      }
    }
  });
});

describe("stamp", () => {
  it("uses the clock when it moves forward", () => {
    expect(stamp(100, 500)).toBe(500);
    expect(stamp(undefined, 500)).toBe(500);
    expect(stamp(null, 500)).toBe(500);
  });
  it("stays after the previous stamp when the clock jumps back", () => {
    expect(stamp(1000, 400)).toBe(1001);
    expect(stamp(1000, 1000)).toBe(1001);
    let t = stamp(undefined, 2000);
    for (const now of [1500, 1500, 3000, 100]) {
      const next = stamp(t, now);
      expect(next).toBeGreaterThan(t);
      t = next;
    }
  });
});

describe("bumpedAt (sql stamp)", () => {
  const q = drizzle(async () => ({ rows: [] }));
  function run(db: DatabaseSync, now: number): number {
    const { sql, params } = q
      .update(templates)
      .set({ name: "x", updatedAt: bumpedAt(templates.updatedAt, now) })
      .where(eq(templates.id, "t1"))
      .toSQL();
    db.prepare(sql).run(...(params as (string | number)[]));
    return (db.prepare("SELECT updated_at AS u FROM templates WHERE id = 't1'").get() as { u: number }).u;
  }
  it("is monotonic per row in a real sqlite update", () => {
    const db = new DatabaseSync(":memory:");
    for (const m of pendingMigrations(0)) for (const s of m.statements) db.exec(s);
    db.exec("INSERT INTO templates (id, name, created_at, updated_at) VALUES ('t1', 'a', 1000, 1000)");
    expect(run(db, 5000)).toBe(5000);
    // clock set back an hour
    expect(run(db, 1500)).toBe(5001);
    expect(run(db, 9000)).toBe(9000);
  });
});

describe("recentTemplates", () => {
  const t = (id: string) => ({ id, name: id });
  const ordered = [t("a"), t("b"), t("c"), t("d"), t("e"), t("f")];
  it("puts the most recently used first, then list order", () => {
    expect(recentTemplates(ordered, { c: 300, e: 500 }).map((x) => x.id)).toEqual(["e", "c", "a", "b"]);
  });
  it("caps at the limit and falls back to position with no history", () => {
    expect(recentTemplates(ordered, {}).map((x) => x.id)).toEqual(["a", "b", "c", "d"]);
    expect(recentTemplates(ordered, { f: 1 }, 2).map((x) => x.id)).toEqual(["f", "a"]);
    expect(recentTemplates([], { a: 1 })).toEqual([]);
  });
  it("ignores history for templates not in the list (archived, deleted) and keeps ties stable", () => {
    expect(recentTemplates(ordered, { gone: 999, d: 10, b: 10 }).map((x) => x.id)).toEqual(["b", "d", "a", "c"]);
  });
});

describe("shouldOfferRestore", () => {
  const base: RestoreOfferState = { hasToken: true, localRows: 0, pending: 0, restoredAt: null, dismissed: false };
  it("offers on an empty db with a surviving token", () => {
    expect(shouldOfferRestore(base)).toBe(true);
  });
  it("stays quiet otherwise", () => {
    expect(shouldOfferRestore({ ...base, hasToken: false })).toBe(false);
    expect(shouldOfferRestore({ ...base, localRows: 1 })).toBe(false);
    expect(shouldOfferRestore({ ...base, pending: 2 })).toBe(false);
    expect(shouldOfferRestore({ ...base, restoredAt: 123 })).toBe(false);
    expect(shouldOfferRestore({ ...base, dismissed: true })).toBe(false);
  });
});

describe("body load", () => {
  it("shades 0 only for no load, within range, never decreasing", () => {
    expect(intensityOf(undefined, 4)).toBe(0);
    expect(intensityOf(0, 4)).toBe(0);
    let prev = 0;
    for (const l of [0.01, 0.2, 0.4, 0.6, 0.8, 1, 5]) {
      const v = intensityOf(l, 4);
      expect(v).toBeGreaterThanOrEqual(Math.max(1, prev));
      expect(v).toBeLessThanOrEqual(4);
      prev = v;
    }
    expect(intensityOf(1, 4)).toBe(4);
  });
  it("lists the heaviest regions first", () => {
    expect(topRegions({ chest: 0.5, quads: 1, lats: 0, biceps: 0.5 }, 3)).toEqual(["quads", "biceps", "chest"]);
    expect(topRegions({}, 3)).toEqual([]);
  });
});

function outboxRow(id: number): OutboxLike {
  return { id, entity: "set", entityId: `s${id}`, op: "insert", payload: JSON.stringify({ id: `s${id}` }), createdAt: id };
}

function memoryOutbox(n: number) {
  const rows = Array.from({ length: n }, (_, i) => ({ ...outboxRow(i + 1), syncedAt: null as number | null }));
  return {
    rows,
    readBatch: (limit: number) => rows.filter((r) => r.syncedAt === null).slice(0, limit),
    ack: (plan: AckPlan) => {
      const acked = new Set(plan.seqs);
      for (const r of rows) if (r.syncedAt === null && acked.has(r.id)) r.syncedAt = 1;
    },
  };
}

const ackAll = (b: { mutations: { seq: number }[] }) => ({
  ok: true,
  appliedThrough: b.mutations.at(-1)!.seq,
  applied: b.mutations.length,
  skipped: 0,
  rejected: [],
});

describe("overlapping syncs", () => {
  it("single flight runs once for concurrent callers and again after", async () => {
    const fn = vi.fn(async (x: number) => x * 2);
    const onChange = vi.fn();
    const f = singleFlight(fn, onChange);
    const [a, b] = await Promise.all([f.run(1), f.run(99)]);
    expect([a, b]).toEqual([2, 2]);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(f.busy()).toBe(false);
    expect(await f.run(3)).toBe(6);
    expect(fn).toHaveBeenCalledTimes(2);
    // start + finish per run
    expect(onChange).toHaveBeenCalledTimes(4);
  });

  it("a rejected run frees the slot", async () => {
    let fail = true;
    const f = singleFlight(async () => {
      if (fail) throw new Error("x");
      return "ok";
    });
    await expect(f.run()).rejects.toThrow("x");
    fail = false;
    expect(await f.run()).toBe("ok");
  });

  it("foreground + manual sync through one flight send each row once", async () => {
    const s = memoryOutbox(5);
    const sent: number[] = [];
    const fetchFn = vi.fn<FetchLike>(async (_u, init) => {
      const body = JSON.parse(init.body!);
      sent.push(...body.mutations.map((m: { seq: number }) => m.seq));
      await new Promise((r) => setTimeout(r, 5));
      return { status: 200, json: async () => ackAll(body) };
    });
    const flight = singleFlight(() =>
      pushAll({ fetch: fetchFn, baseUrl: "https://x.org", token: "t", deviceId: "d", readBatch: s.readBatch, ack: s.ack })
    );
    const [a, b] = await Promise.all([flight.run(), flight.run()]);
    expect(a).toBe(b);
    expect(sent).toEqual([1, 2, 3, 4, 5]);
    expect(s.rows.every((r) => r.syncedAt !== null)).toBe(true);
  });

  it("without it the same rows would go out twice (why the guard exists)", async () => {
    const s = memoryOutbox(3);
    const sent: number[] = [];
    const fetchFn = vi.fn<FetchLike>(async (_u, init) => {
      const body = JSON.parse(init.body!);
      sent.push(...body.mutations.map((m: { seq: number }) => m.seq));
      await new Promise((r) => setTimeout(r, 5));
      return { status: 200, json: async () => ackAll(body) };
    });
    const go = () => pushAll({ fetch: fetchFn, baseUrl: "https://x.org", token: "t", deviceId: "d", readBatch: s.readBatch, ack: s.ack });
    await Promise.all([go(), go()]);
    expect(sent).toEqual([1, 2, 3, 1, 2, 3]);
  });
});

describe("ack only marks what the request carried", () => {
  it("planAck lists exactly the sent seqs up to the ack", () => {
    const res = { ok: true as const, appliedThrough: 9, applied: 0, skipped: 0, rejected: [] };
    // 3 was requeued after this batch was read, so it isn't in it
    expect(planAck([1, 2, 4, 5], res).seqs).toEqual([1, 2, 4, 5]);
    expect(planAck([1, 2, 4, 5], { ...res, appliedThrough: 4 }).seqs).toEqual([1, 2, 4]);
  });

  it("a row requeued or written while a push is in flight stays unsynced", async () => {
    const s = memoryOutbox(4);
    // row 2 starts synced; it gets requeued while round one is on the wire
    s.rows[1]!.syncedAt = 1;
    let round = 0;
    const fetchFn = vi.fn<FetchLike>(async (_u, init) => {
      const body = JSON.parse(init.body!);
      round++;
      if (round === 1) {
        s.rows[1]!.syncedAt = null;
        s.rows.push({ ...outboxRow(5), syncedAt: null });
        // the server answers for the older request only
        return { status: 200, json: async () => ackAll(body) };
      }
      return { status: 500, json: async () => ({}) };
    });
    const r = await pushAll({ fetch: fetchFn, baseUrl: "https://x.org", token: "t", deviceId: "d", readBatch: s.readBatch, ack: s.ack });
    expect(r.ok).toBe(false);
    expect(s.rows.map((x) => [x.id, x.syncedAt !== null])).toEqual([
      [1, true],
      [2, false],
      [3, true],
      [4, true],
      [5, false],
    ]);
  });
});
