import { describe, it, expect, vi, beforeEach } from "vitest";

const { garminPull, intervalsPull, garminOn, intervalsOn, order } = vi.hoisted(() => ({
  garminPull: vi.fn(),
  intervalsPull: vi.fn(),
  garminOn: { value: true },
  intervalsOn: { value: true },
  order: [] as string[],
}));

vi.mock("@/lib/garmin", () => ({
  isGarminConfigured: () => garminOn.value,
  pullGarminActivities: (o: unknown) => {
    order.push("garmin");
    return garminPull(o);
  },
}));
vi.mock("@/lib/intervals", () => ({
  isIntervalsConfigured: () => intervalsOn.value,
  pullIntervalsActivities: (o: unknown) => {
    order.push("intervals");
    return intervalsPull(o);
  },
}));

import { syncActivitiesNow } from "@/lib/activity-sync";
import { isDryRun, UpstreamUnavailableError } from "@/lib/sync-log";

const pulled = (over: Record<string, unknown> = {}) => ({ inserted: 0, upgraded: 0, linked: 0, updated: 0, skipped: 0, failures: [], more: false, ...over });

let lines: string[] = [];
beforeEach(() => {
  vi.clearAllMocks();
  order.length = 0;
  garminOn.value = true;
  intervalsOn.value = true;
  garminPull.mockResolvedValue(pulled());
  intervalsPull.mockResolvedValue(pulled());
  lines = [];
  vi.spyOn(console, "log").mockImplementation((l: unknown) => void lines.push(String(l)));
});

describe("syncActivitiesNow", () => {
  it("pulls garmin first, then intervals, over the 3-day window", async () => {
    intervalsPull.mockResolvedValue(pulled({ inserted: 1 }));
    const r = await syncActivitiesNow({ trigger: "poll" });
    expect(order).toEqual(["garmin", "intervals"]);
    expect(garminPull).toHaveBeenCalledWith({ days: 3, metadataDays: 3 });
    expect(intervalsPull).toHaveBeenCalledWith({ days: 3, metadataDays: 3 });
    expect(r).toMatchObject({ dryRun: false, changed: true, intervals: { inserted: 1 } });
    expect(r.runId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("a source without its key is simply off", async () => {
    garminOn.value = false;
    const r = await syncActivitiesNow({ trigger: "telegram" });
    expect(r.garmin).toEqual({ off: true });
    expect(garminPull).not.toHaveBeenCalled();
    expect(r.changed).toBe(false);
  });

  it("a 429 from one source skips it for this run (recorded) and the other still runs", async () => {
    garminPull.mockRejectedValue(new UpstreamUnavailableError("garmin", 429, "garmin answered 429"));
    const r = await syncActivitiesNow({ trigger: "poll" });
    expect(r.garmin).toEqual({ skipped: "garmin answered 429" });
    expect(intervalsPull).toHaveBeenCalledTimes(1);
    expect(garminPull).toHaveBeenCalledTimes(1);
    expect(lines.some((l) => l.includes(" garmin skip ") && l.includes('"status":429'))).toBe(true);
  });

  it("any other failure is an error for that source only", async () => {
    intervalsPull.mockRejectedValue(new Error("rejected the api key"));
    const r = await syncActivitiesNow({ trigger: "cron", days: 7, metadataDays: 14 });
    expect(r.intervals).toEqual({ error: "rejected the api key" });
    expect(garminPull).toHaveBeenCalledWith({ days: 7, metadataDays: 14 });
    expect(lines.some((l) => l.includes(" intervals error "))).toBe(true);
  });

  it("dry run reaches the pulls and can be limited to one source", async () => {
    let sawDry = false;
    garminPull.mockImplementation(async () => {
      sawDry = isDryRun();
      return pulled();
    });
    const r = await syncActivitiesNow({ trigger: "script", dryRun: true, sources: ["garmin"] });
    expect(sawDry).toBe(true);
    expect(r.dryRun).toBe(true);
    expect(r.intervals).toEqual({ off: true });
    expect(lines.every((l) => l.startsWith("[dry run]"))).toBe(true);
  });
});
