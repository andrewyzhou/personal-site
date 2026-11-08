import { describe, it, expect } from "vitest";
import { mergeUpstreamMeta, recordSiteEdits, type MetaValues, type UpstreamSnapshot, type UpstreamValues } from "../metadata-merge";

const NOW = new Date("2026-10-10T12:00:00Z");
const SEEN = "2026-10-08T00:00:00.000Z"; // the previous sync

const current = (over: Partial<MetaValues> = {}): MetaValues => ({
  name: "Morning Run",
  description: null,
  sportType: "Run",
  hidden: false,
  ...over,
});
const prev = (over: Partial<UpstreamSnapshot> = {}): UpstreamSnapshot => ({
  provider: "intervals-icu",
  externalId: "i1",
  name: "Morning Run",
  description: null,
  sportType: "Run",
  hidden: false,
  seenAt: SEEN,
  ...over,
});

function merge(opts: {
  current?: Partial<MetaValues>;
  site?: Record<string, string> | null;
  previous?: UpstreamSnapshot | null;
  upstream: UpstreamValues;
  changedAt?: string | null;
}) {
  return mergeUpstreamMeta({
    current: current(opts.current),
    siteEdits: opts.site ?? null,
    previous: opts.previous === undefined ? prev() : opts.previous,
    upstream: opts.upstream,
    provider: "intervals-icu",
    externalId: "i1",
    changedAt: opts.changedAt ? new Date(opts.changedAt) : null,
    now: NOW,
  });
}

describe("mergeUpstreamMeta", () => {
  it("applies an upstream rename when the site never edited the name", () => {
    const r = merge({ upstream: { name: "Tempo" } });
    expect(r.updates).toEqual({ name: "Tempo" });
    expect(r.applied).toEqual(["name"]);
    expect(r.snapshot).toMatchObject({ name: "Tempo", seenAt: NOW.toISOString() });
  });

  it("first sighting only records a baseline: a row's own name is never replaced", () => {
    const r = merge({ previous: null, current: { name: "archive name" }, upstream: { name: "Morning Run", description: "x", sportType: "Ride" } });
    expect(r.updates).toEqual({});
    expect(r.skipped.map((s) => s.reason)).toEqual(["first-sighting", "first-sighting", "first-sighting"]);
    expect(r.snapshot).toMatchObject({ name: "Morning Run", description: "x", sportType: "Ride", hidden: false });
  });

  it("a snapshot from another provider identity is not a baseline", () => {
    const r = merge({ previous: prev({ externalId: "i2" }), upstream: { name: "Tempo" } });
    expect(r.updates).toEqual({});
    expect(r.snapshot.externalId).toBe("i1");
  });

  it("unchanged upstream values never overwrite a different row value", () => {
    const r = merge({ current: { name: "renamed on site" }, upstream: { name: "Morning Run" } });
    expect(r.updates).toEqual({});
    expect(r.skipped).toEqual([{ field: "name", reason: "unchanged" }]);
  });

  describe("with an event time (webhook)", () => {
    it("upstream newer than the site's edit wins", () => {
      const r = merge({ site: { name: "2026-10-09T00:00:00Z" }, upstream: { name: "Tempo" }, changedAt: "2026-10-09T01:00:00Z" });
      expect(r.updates).toEqual({ name: "Tempo" });
    });

    it("site newer than the upstream edit wins", () => {
      const r = merge({ site: { name: "2026-10-09T02:00:00Z" }, upstream: { name: "Tempo" }, changedAt: "2026-10-09T01:00:00Z" });
      expect(r.updates).toEqual({});
      expect(r.skipped).toEqual([{ field: "name", reason: "site-newer" }]);
      // the snapshot still moves, so the same upstream value isn't re-applied later
      expect(r.snapshot.name).toBe("Tempo");
    });

    it("a tie goes to the site", () => {
      const r = merge({ site: { name: "2026-10-09T01:00:00Z" }, upstream: { name: "Tempo" }, changedAt: "2026-10-09T01:00:00Z" });
      expect(r.updates).toEqual({});
    });
  });

  describe("without an event time (scheduled pull)", () => {
    it("a site edit before the previous sync is older than the upstream change", () => {
      const r = merge({ site: { name: "2026-10-07T00:00:00Z" }, upstream: { name: "Tempo" } });
      expect(r.updates).toEqual({ name: "Tempo" });
    });

    it("a site edit after the previous sync might be newer: the site wins", () => {
      const r = merge({ site: { name: "2026-10-09T00:00:00Z" }, upstream: { name: "Tempo" } });
      expect(r.updates).toEqual({});
      expect(r.skipped[0].reason).toBe("site-newer");
    });
  });

  it("fields are independent: a site rename doesn't block an upstream description", () => {
    const r = merge({
      site: { name: "2026-10-09T00:00:00Z" },
      upstream: { name: "Tempo", description: "legs heavy" },
      changedAt: "2026-10-08T12:00:00Z",
    });
    expect(r.updates).toEqual({ description: "legs heavy" });
  });

  it("descriptions can be cleared upstream; names and types never go blank", () => {
    const withDesc = prev({ description: "old" });
    expect(merge({ previous: withDesc, current: { description: "old" }, upstream: { description: "  " } }).updates).toEqual({ description: null });
    expect(merge({ upstream: { name: "" } }).skipped).toEqual([{ field: "name", reason: "empty" }]);
    expect(merge({ upstream: { sportType: null } }).skipped).toEqual([{ field: "sportType", reason: "empty" }]);
  });

  it("trims upstream text", () => {
    expect(merge({ upstream: { name: "  Tempo  " } }).updates).toEqual({ name: "Tempo" });
  });

  describe("sport type", () => {
    it("an upstream type change applies while the site never set the type", () => {
      expect(merge({ upstream: { sportType: "TrailRun" } }).updates).toEqual({ sportType: "TrailRun" });
    });

    it("once set on the site, the site's type sticks, even against a newer upstream change", () => {
      const r = merge({ site: { sportType: "2026-10-01T00:00:00Z" }, current: { sportType: "Hike" }, upstream: { sportType: "TrailRun" }, changedAt: "2026-10-09T00:00:00Z" });
      expect(r.updates).toEqual({});
      expect(r.skipped).toEqual([{ field: "sportType", reason: "site-set-sport" }]);
    });
  });

  describe("hidden", () => {
    it("an upstream delete hides, even on a first sighting", () => {
      expect(merge({ previous: null, upstream: { hidden: true } }).updates).toEqual({ hidden: true });
    });

    it("never unhides", () => {
      const r = merge({ previous: prev({ hidden: true }), current: { hidden: true }, upstream: { hidden: false } });
      expect(r.updates).toEqual({});
      expect(r.skipped).toEqual([{ field: "hidden", reason: "never-unhide" }]);
    });

    it("a site un-hide after the delete wins", () => {
      const r = merge({ site: { hidden: "2026-10-09T05:00:00Z" }, upstream: { hidden: true }, changedAt: "2026-10-09T04:00:00Z" });
      expect(r.updates).toEqual({});
    });

    it("a delete after the site's last hidden toggle hides", () => {
      const r = merge({ site: { hidden: "2026-10-09T03:00:00Z" }, upstream: { hidden: true }, changedAt: "2026-10-09T04:00:00Z" });
      expect(r.updates).toEqual({ hidden: true });
    });

    it("already hidden: nothing to do", () => {
      expect(merge({ current: { hidden: true }, upstream: { hidden: true } }).updates).toEqual({});
    });
  });

  it("fields the upstream doesn't report keep their snapshot value", () => {
    const r = merge({ previous: prev({ description: "kept" }), upstream: { name: "Tempo" } });
    expect(r.snapshot).toMatchObject({ name: "Tempo", description: "kept", sportType: "Run" });
  });

  it("a snapshot doesn't re-apply: syncing the same upstream twice changes nothing the second time", () => {
    const first = merge({ upstream: { name: "Tempo" } });
    const second = mergeUpstreamMeta({
      current: current(first.updates),
      siteEdits: null,
      previous: first.snapshot,
      upstream: { name: "Tempo" },
      provider: "intervals-icu",
      externalId: "i1",
      changedAt: null,
      now: NOW,
    });
    expect(second.updates).toEqual({});
  });

  it("site edit → later upstream edit → later site edit: each newest one wins in turn", () => {
    // 1. site renames at t1
    let site = recordSiteEdits(null, current(), { name: "site 1" }, new Date("2026-10-09T00:00:00Z"));
    let row = current({ name: "site 1" });
    // 2. garmin renames at t2 > t1 (webhook)
    const up = mergeUpstreamMeta({
      current: row, siteEdits: site, previous: prev(), upstream: { name: "garmin 2" },
      provider: "intervals-icu", externalId: "i1", changedAt: new Date("2026-10-09T01:00:00Z"), now: new Date("2026-10-09T01:00:05Z"),
    });
    expect(up.updates).toEqual({ name: "garmin 2" });
    row = current({ ...row, ...up.updates });
    // 3. site renames again at t3; a later pull sees the unchanged upstream and keeps it
    site = recordSiteEdits(site, row, { name: "site 3" }, new Date("2026-10-09T02:00:00Z"));
    row = current({ ...row, name: "site 3" });
    const pull = mergeUpstreamMeta({
      current: row, siteEdits: site, previous: up.snapshot, upstream: { name: "garmin 2" },
      provider: "intervals-icu", externalId: "i1", changedAt: null, now: new Date("2026-10-10T00:00:00Z"),
    });
    expect(pull.updates).toEqual({});
  });
});

describe("recordSiteEdits", () => {
  const at = new Date("2026-10-09T00:00:00Z");

  it("stamps only fields whose value changed", () => {
    const r = recordSiteEdits(null, current(), { name: "Morning Run", description: "new", sportType: "Run", hidden: true }, at);
    expect(r).toEqual({ description: at.toISOString(), hidden: at.toISOString() });
  });

  it("keeps earlier stamps for untouched fields", () => {
    const r = recordSiteEdits({ name: "2026-01-01T00:00:00.000Z" }, current(), { sportType: "Hike" }, at);
    expect(r).toEqual({ name: "2026-01-01T00:00:00.000Z", sportType: at.toISOString() });
  });

  it("clearing a description is an edit", () => {
    expect(recordSiteEdits(null, current({ description: "x" }), { description: null }, at)).toEqual({ description: at.toISOString() });
  });
});
