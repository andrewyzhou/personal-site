import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { B_PREFIX, B_REDIRECTS, DEFAULT_SITE_DESIGN, hasBPage } from "@/designs/routes";
import { dayLabel, sportGroup, summarize, toTrainingItem, type TrainingItem } from "@/content/training";
import { activityStats, fogLine } from "@/content/activity";
import type { CalendarActivity } from "@/lib/calendar-activity";

describe("hub site routing", () => {
  it("v1 stays the public default until the owner flips it", () => {
    expect(DEFAULT_SITE_DESIGN).toBe("v1");
  });

  it("rewrites only urls that have a b page", () => {
    for (const p of ["/", "/work", "/writing", "/training", "/photos", "/blog/sample-post", "/library/sample-book", "/activities/496"]) expect(hasBPage(p), p).toBe(true);
    for (const p of ["/activities/records", "/lifts", "/lifts/abc", "/photos/trip", "/admin", "/blog", "/activities/abc", "/work/x"]) expect(hasBPage(p), p).toBe(false);
  });

  it("every b url has a page file in the b tree", () => {
    const files: Record<string, string> = {
      "/": "page.tsx",
      "/work": "work/page.tsx",
      "/writing": "writing/page.tsx",
      "/training": "training/page.tsx",
      "/photos": "photos/page.tsx",
      "/blog/x": "blog/[slug]/page.tsx",
      "/library/x": "library/[slug]/page.tsx",
      "/activities/1": "activities/[id]/page.tsx",
    };
    for (const [url, file] of Object.entries(files)) {
      expect(hasBPage(url)).toBe(true);
      expect(fs.existsSync(path.join("src/app", B_PREFIX, file)), file).toBe(true);
    }
  });

  it("folds old index pages into hubs", () => {
    expect(B_REDIRECTS["/blog"]).toBe("/writing?kind=post");
    expect(B_REDIRECTS["/library"]).toBe("/writing?kind=note");
  });
});

const activity = (over: Partial<CalendarActivity>): CalendarActivity => ({
  id: 1,
  name: "x",
  type: "Run",
  date: "2026-11-03",
  startTime: "08:00",
  distance: 5000,
  duration: 1500,
  elapsedTime: 1600,
  totalElevationGain: 10,
  averageSpeed: 3.3,
  maxSpeed: 4,
  averageHeartrate: null,
  maxHeartrate: null,
  averageCadence: null,
  averageWatts: null,
  maxWatts: null,
  kilojoules: null,
  description: null,
  sufferScore: null,
  ...over,
});

describe("training feed", () => {
  it("groups sports", () => {
    expect(sportGroup("TrailRun")).toBe("runs");
    expect(sportGroup("GravelRide")).toBe("rides");
    expect(sportGroup("WeightTraining")).toBe("lifts");
    expect(sportGroup("Soccer")).toBe("other");
  });

  it("shows distance for moving sessions and time or the set summary otherwise", () => {
    expect(toTrainingItem(activity({})).stat).toBe("3.11 mi");
    expect(toTrainingItem(activity({ type: "WeightTraining", distance: 0, duration: 3922 })).stat).toBe("1:05:22");
    const lift = toTrainingItem(activity({ type: "WeightTraining", distance: 0, href: "/lifts/abc", liftSummary: "3 exercises · 6 sets" }));
    expect(lift.stat).toBe("3 exercises · 6 sets");
    expect(lift.href).toBe("/lifts/abc");
    expect(toTrainingItem(activity({ id: 9 })).href).toBe("/activities/9");
  });

  it("labels days", () => {
    expect(dayLabel("2026-11-02")).toBe("nov 2");
  });

  it("summarizes the week from monday and the year's distance", () => {
    const items: TrainingItem[] = [
      toTrainingItem(activity({ date: "2026-11-02" })), // monday
      toTrainingItem(activity({ date: "2026-11-04" })), // wednesday
      toTrainingItem(activity({ date: "2026-11-01" })), // previous sunday
      toTrainingItem(activity({ date: "2025-12-31" })),
    ];
    const s = summarize(items, "2026-11-04");
    expect(s.thisWeek).toBe(2);
    expect(s.year).toBe(2026);
    expect(s.yearDistanceMi).toBe(((3 * 5000) / 1609.344).toFixed(1));
    expect(s.total).toBe(4);
  });
});

describe("activity page content", () => {
  it("sums fog into whole minutes", () => {
    expect(fogLine([{ durationS: 400 }, { durationS: 440 }])).toBe("in the fog · 14 min");
    expect(fogLine(null)).toBeNull();
    expect(fogLine([{ durationS: 10 }])).toBeNull();
  });

  it("orders stats the way the page always has", () => {
    const a = { ...activity({ type: "Hike", distance: 47223, totalElevationGain: 1140, averageHeartrate: 142 }), hrZonesS: null } as unknown as Parameters<typeof activityStats>[0];
    expect(activityStats(a).map((s) => s.label)).toEqual(["time", "distance", "avg pace", "elevation", "avg hr"]);
  });
});
