import { describe, it, expect, vi } from "vitest";

vi.mock("../cache", () => ({ invalidateCache: vi.fn() }));

import { republishPending, type RebuildDeps } from "../privacy/rebuild";
import type { RepublishResult } from "../republish";

function deps(over: Partial<RebuildDeps> & { statuses?: Record<number, RepublishResult["status"] | Error> } = {}) {
  let clock = 0;
  const flagged = new Set([5, 4, 3, 2, 1]);
  const d: RebuildDeps & { flagged: Set<number>; tick: (ms: number) => void } = {
    flagged,
    tick: (ms) => (clock += ms),
    now: () => clock,
    selectPending: vi.fn(async (limit: number, exclude: number[]) => [...flagged].filter((id) => !exclude.includes(id)).slice(0, limit)),
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
  it("republishes pending rows, invalidates caches once, revalidates written pages", async () => {
    const d = deps({ statuses: { 3: "fresh", 2: "no-source" } });
    const revalidate = vi.fn();
    const r = await republishPending({ deps: d, revalidate });
    expect(r.results.map((x) => [x.id, x.status])).toEqual([
      [5, "published"], [4, "published"], [3, "fresh"], [2, "no-source"], [1, "published"],
    ]);
    expect(d.invalidate).toHaveBeenCalledTimes(1);
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

  it("a revalidate failure doesn't fail the batch", async () => {
    const d = deps();
    const r = await republishPending({ deps: d, revalidate: () => { throw new Error("outside a request"); } });
    expect(r.results).toHaveLength(5);
  });
});
