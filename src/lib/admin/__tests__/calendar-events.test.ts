import { describe, it, expect, vi, beforeEach } from "vitest";

// thenable query-chain stub: every builder method returns the chain; awaiting it
// resolves the next queued result. lets the real calendar code run unchanged.
const { queue, mockDb } = vi.hoisted(() => {
  const queue: unknown[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {};
  for (const m of ["select", "from", "where", "orderBy", "limit"]) {
    chain[m] = () => chain;
  }
  chain.then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
    const next = queue.shift();
    if (next instanceof Error) reject(next);
    else resolve(next);
  };
  return { queue, mockDb: chain };
});

vi.mock("@/lib/db", () => ({
  getDb: () => mockDb,
  activities: new Proxy({}, { get: () => ({}) }),
  activityPhotos: new Proxy({}, { get: () => ({}) }),
}));

vi.mock("drizzle-orm", () => ({
  desc: (x: unknown) => x,
  asc: (x: unknown) => x,
  eq: () => ({}),
  and: () => ({}),
  gte: () => ({}),
  lte: () => ({}),
  inArray: () => ({}),
}));

const { readStoredSubmissions } = vi.hoisted(() => ({ readStoredSubmissions: vi.fn() }));
vi.mock("@/lib/leetcode-sync", () => ({ readStoredSubmissions }));

const { getContributions } = vi.hoisted(() => ({ getContributions: vi.fn() }));
vi.mock("@/lib/github", () => ({ getContributions }));

const { listEntries } = vi.hoisted(() => ({ listEntries: vi.fn() }));
vi.mock("@/lib/admin/content-store", () => ({ listEntries }));

import { getCalendarEvents } from "../calendar-events";

beforeEach(() => {
  queue.length = 0;
  readStoredSubmissions.mockReset();
  getContributions.mockReset();
  listEntries.mockReset();
  // defaults: everything empty
  readStoredSubmissions.mockResolvedValue({ submissions: [], lastFetchedAt: 1 });
  getContributions.mockResolvedValue({ totalContributions: 0, weeks: [] });
  listEntries.mockResolvedValue({ items: [], stale: false });
});

describe("getCalendarEvents", () => {
  it("merges all sources sorted by date desc with all sources ok", async () => {
    queue.push(
      [{ id: 1, date: "2026-06-10", startTime: "07:00", type: "Run", name: "run" }], // activities
      [{ activityId: 1, url: "https://cdn.andrewzhou.org/p.jpg" }] // photos
    );
    readStoredSubmissions.mockResolvedValue({
      submissions: [{ sha: "abc", date: "2026-06-12", problemNumber: 1, problemTitle: "two sum", difficulty: "easy", url: "u" }],
      lastFetchedAt: 1,
    });
    getContributions.mockResolvedValue({
      totalContributions: 3,
      weeks: [{ days: [{ date: "2026-06-11", count: 3, level: 2 }] }],
    });

    const payload = await getCalendarEvents("2026-06", "2026-06");
    expect(payload.sources).toEqual({ activities: "ok", leetcode: "ok", commits: "ok", content: "ok" });
    expect(payload.events.map((e) => e.date)).toEqual(["2026-06-12", "2026-06-11", "2026-06-10"]);
    const activity = payload.events.find((e) => e.kind === "activity");
    expect(activity && "thumb" in activity && activity.thumb).toBe("https://cdn.andrewzhou.org/p.jpg");
  });

  it("activities without photos carry no thumb", async () => {
    queue.push([{ id: 2, date: "2026-06-10", startTime: "07:00", type: "Run", name: "run" }], []);
    const payload = await getCalendarEvents("2026-06", "2026-06");
    const activity = payload.events.find((e) => e.kind === "activity");
    expect(activity).toBeDefined();
    expect(activity && "thumb" in activity).toBe(false);
    expect(activity && "routePolyline" in activity).toBe(false);
  });

  it("photo-less gps activities carry routePolyline so the client can draw the map", async () => {
    queue.push([{ id: 5, date: "2026-06-10", startTime: "07:00", type: "Run", name: "run", cardPolyline: "abc123" }], []);
    const payload = await getCalendarEvents("2026-06", "2026-06");
    const activity = payload.events.find((e) => e.kind === "activity");
    expect(activity && "routePolyline" in activity && activity.routePolyline).toBe("abc123");
    expect(activity && "thumb" in activity).toBe(false);
    expect(activity && "cardPolyline" in activity).toBe(false); // raw column never leaks
  });

  it("a photo thumb wins over the route polyline", async () => {
    queue.push(
      [{ id: 6, date: "2026-06-10", startTime: "07:00", type: "Run", name: "run", cardPolyline: "abc123" }],
      [{ activityId: 6, url: "https://cdn.andrewzhou.org/p.jpg" }]
    );
    const payload = await getCalendarEvents("2026-06", "2026-06");
    const activity = payload.events.find((e) => e.kind === "activity");
    expect(activity && "thumb" in activity && activity.thumb).toBe("https://cdn.andrewzhou.org/p.jpg");
    expect(activity && "routePolyline" in activity).toBe(false);
  });

  it("photo-thumbnail query failure degrades to thumbless events, not a dead source (review finding)", async () => {
    queue.push(
      [{ id: 3, date: "2026-06-10", startTime: "07:00", type: "Run", name: "run" }],
      new Error("neon transient failure")
    );
    const payload = await getCalendarEvents("2026-06", "2026-06");
    expect(payload.sources.activities).toBe("ok");
    const activity = payload.events.find((e) => e.kind === "activity");
    expect(activity).toBeDefined();
    expect(activity && "thumb" in activity).toBe(false);
  });

  it("isolates a failing source and flags it", async () => {
    queue.push([]); // activities: no rows → no photo query
    getContributions.mockRejectedValue(new Error("github down"));
    const payload = await getCalendarEvents("2026-06", "2026-06");
    expect(payload.sources.commits).toBe("error");
    expect(payload.sources.activities).toBe("ok");
    expect(payload.sources.content).toBe("ok");
  });

  it("resolves thumbs per content type: blog/library covers verbatim, photos v1 path, v2 src", async () => {
    queue.push([]);
    listEntries.mockImplementation(async (t: { id: string }) => {
      if (t.id === "blog") {
        return { items: [{ slug: "post", status: "published", path: "p", sha: "s", frontmatter: { title: "post", date: "2026-06-01", cover: "/blog/post/cover.jpg" } }], stale: false };
      }
      if (t.id === "library") {
        return { items: [{ slug: "book", status: "published", path: "p", sha: "s", frontmatter: { title: "book", dateCompleted: "2026-06-02", cover: "https://cdn.andrewzhou.org/lib.jpg" } }], stale: false };
      }
      return {
        items: [
          { slug: "flatset", status: "published", path: "p", sha: "s", frontmatter: { title: "flat", date: "2026-06-03", cover: "01.jpg" } },
          { slug: "essay", status: "wip", path: "p", sha: "s", frontmatter: { title: "essay", date: "2026-06-04", cover: { src: "https://cdn.andrewzhou.org/e.jpg" } } },
        ],
        stale: false,
      };
    });

    const payload = await getCalendarEvents("2026-06", "2026-06");
    const bySlug = Object.fromEntries(
      payload.events.filter((e) => "slug" in e).map((e) => [(e as { slug: string }).slug, e as { thumb?: string }])
    );
    expect(bySlug.post.thumb).toBe("/blog/post/cover.jpg");
    expect(bySlug.book.thumb).toBe("https://cdn.andrewzhou.org/lib.jpg");
    expect(bySlug.flatset.thumb).toBe("/photos/flatset/01.jpg");
    expect(bySlug.essay.thumb).toBe("https://cdn.andrewzhou.org/e.jpg");
  });

  it("library dates fall back dateCompleted → dateStarted, undated excluded; out-of-range excluded", async () => {
    queue.push([]);
    listEntries.mockImplementation(async (t: { id: string }) => {
      if (t.id === "library") {
        return {
          items: [
            { slug: "started", status: "published", path: "p", sha: "s", frontmatter: { title: "s", dateStarted: "2026-06-05" } },
            { slug: "undated", status: "published", path: "p", sha: "s", frontmatter: { title: "u" } },
            { slug: "old", status: "published", path: "p", sha: "s", frontmatter: { title: "o", dateCompleted: "2025-01-01" } },
          ],
          stale: false,
        };
      }
      return { items: [], stale: false };
    });

    const payload = await getCalendarEvents("2026-06", "2026-06");
    const slugs = payload.events.filter((e) => "slug" in e).map((e) => (e as { slug: string }).slug);
    expect(slugs).toEqual(["started"]);
  });

  it("commit days with zero count are excluded", async () => {
    queue.push([]);
    getContributions.mockResolvedValue({
      totalContributions: 1,
      weeks: [{ days: [{ date: "2026-06-11", count: 0, level: 0 }, { date: "2026-06-12", count: 2, level: 1 }] }],
    });
    const payload = await getCalendarEvents("2026-06", "2026-06");
    const commits = payload.events.filter((e) => e.kind === "commit");
    expect(commits).toHaveLength(1);
    expect(commits[0].date).toBe("2026-06-12");
  });
});
