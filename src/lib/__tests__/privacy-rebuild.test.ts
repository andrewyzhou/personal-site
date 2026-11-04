import { describe, it, expect, vi } from "vitest";

vi.mock("../cache", () => ({ invalidateCache: vi.fn() }));

import { DEFAULT_REBUILD_BUDGET_MS, republishPending, type RebuildDeps } from "../privacy/rebuild";
import type { RepublishResult } from "../republish";

function deps(over: Partial<RebuildDeps> & { statuses?: Record<number, RepublishResult["status"] | Error> } = {}) {
  let clock = 0;
  const flagged = new Set([5, 4, 3, 2, 1]);
  const d: RebuildDeps & { flagged: Set<number>; tick: (ms: number) => void } = {
    flagged,
    tick: (ms) => (clock += ms),
    now: () => clock,
    selectPending: vi.fn(async (limit: number, exclude: number[]) => [...flagged].filter((id) => !exclude.includes(id)).slice(0, limit)),
    markAttempted: vi.fn(async () => undefined),
    countPending: vi.fn(async () => flagged.size),
    invalidate: vi.fn(async () => undefined),
    republish: vi.fn(async (id: number) => {
      const s = over.statuses?.[id] ?? "published";
      if (s instanceof Error) throw s;
      // republish clears the flag only when it writes or finds the row fresh
      if (s === "published" || s === "fresh" || s === "no-source") flagged.delete(id);
      return { status: s, id } as RepublishResult;
    }),
    ...over,
  };
  return d;
}

describe("republishPending", () => {
  it("republishes pending rows, invalidates caches and revalidates each written page", async () => {
    const d = deps({ statuses: { 3: "fresh", 2: "no-source" } });
    const revalidate = vi.fn();
    const r = await republishPending({ deps: d, revalidate });
    expect(r.results.map((x) => [x.id, x.status])).toEqual([
      [5, "published"], [4, "published"], [3, "fresh"], [2, "no-source"], [1, "published"],
    ]);
    expect(d.invalidate).toHaveBeenCalledTimes(4);
    expect(revalidate.mock.calls.map((c) => c[0])).toEqual(["/activities/5", "/activities/4", "/activities/2", "/activities/1"]);
    expect(r.remaining).toBe(0);
    expect(r.timedOut).toBe(false);
  });

  it("an error or unreadable source keeps the row pending and is reported", async () => {
    const d = deps({ statuses: { 4: new Error("boom"), 2: "source-unavailable" } });
    const r = await republishPending({ deps: d });
    expect(r.results.find((x) => x.id === 4)).toEqual({ id: 4, status: "error", error: "boom" });
    expect(r.failedIds).toEqual([4, 2]);
    expect(r.remaining).toBe(2);
    expect([...d.flagged].sort()).toEqual([2, 4]);
    // every attempt is stamped first, so failing rows move to the back of the queue
    expect((d.markAttempted as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0])).toEqual([5, 4, 3, 2, 1]);
  });

  it("stops at the time budget", async () => {
    const d = deps();
    (d.republish as ReturnType<typeof vi.fn>).mockImplementation(async (id: number) => {
      d.tick(15_000);
      d.flagged.delete(id);
      return { status: "published", id };
    });
    const r = await republishPending({ deps: d, timeBudgetMs: 40_000 });
    expect(r.results.map((x) => x.id)).toEqual([5, 4, 3]);
    expect(r.timedOut).toBe(true);
    expect(r.remaining).toBe(2);
  });

  it("nothing written → no cache invalidation; exclusions and limit pass through", async () => {
    const d = deps({ statuses: { 5: "fresh", 4: "fresh" } });
    const revalidate = vi.fn();
    await republishPending({ deps: d, limit: 2, excludeIds: [9], revalidate });
    expect(d.selectPending).toHaveBeenCalledWith(2, [9]);
    expect(d.invalidate).not.toHaveBeenCalled();
    expect(revalidate).not.toHaveBeenCalled();
  });

  it("each page is revalidated right after its own write, before the next republish", async () => {
    const order: string[] = [];
    const d = deps({ statuses: { 4: "fresh" } });
    const inner = d.republish;
    d.republish = vi.fn(async (id: number) => {
      order.push(`republish ${id}`);
      return inner(id);
    });
    await republishPending({ deps: d, limit: 3, revalidate: (p) => order.push(`revalidate ${p}`) });
    expect(order).toEqual(["republish 5", "revalidate /activities/5", "republish 4", "republish 3", "revalidate /activities/3"]);
  });

  it("pages written before a later failure are already revalidated", async () => {
    const d = deps();
    const revalidate = vi.fn();
    (d.republish as ReturnType<typeof vi.fn>).mockImplementation(async (id: number) => {
      if (id === 3) throw new Error("boom");
      return { status: "published", id };
    });
    await republishPending({ deps: d, limit: 3, revalidate });
    expect(revalidate.mock.calls.map((c) => c[0])).toEqual(["/activities/5", "/activities/4"]);
  });

  it("the default budget leaves headroom under the 60 s function limit", async () => {
    const d = deps();
    (d.republish as ReturnType<typeof vi.fn>).mockImplementation(async (id: number) => {
      d.tick(10_000);
      return { status: "published", id };
    });
    const r = await republishPending({ deps: d });
    expect(DEFAULT_REBUILD_BUDGET_MS).toBeLessThanOrEqual(30_000);
    expect(r.results).toHaveLength(3);
    expect(r.timedOut).toBe(true);
  });

  it("a revalidate failure doesn't fail the batch", async () => {
    const d = deps();
    const r = await republishPending({ deps: d, revalidate: () => { throw new Error("outside a request"); } });
    expect(r.results).toHaveLength(5);
  });
});
