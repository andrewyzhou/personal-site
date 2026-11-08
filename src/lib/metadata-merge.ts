// newest edit wins, per field, between site edits (admin) and upstream edits
// (garmin → intervals.icu). pure; the caller loads/stores the two jsonb
// columns it reads (activities.meta_edited_at, activities.upstream_meta).
//
// how an upstream edit is detected: each sync stores the upstream values it
// saw (the snapshot). a field changed upstream only when the fresh upstream
// value differs from the snapshot — never merely because it differs from the
// row, which may hold a site edit or an older source's name. so:
//   - the first sighting of an activity only records the snapshot (rows that
//     came from another source keep their names);
//   - an upstream change applies unless the site edited that field later.
//     the upstream change time is the webhook event's timestamp when there is
//     one; a daily pull only knows the change happened after the previous
//     snapshot, so a site edit made after that snapshot wins (ties go to the
//     site);
//   - sport type: garmin doesn't forward type changes, so once the site has
//     set it, upstream never overrides it;
//   - hidden: upstream can only hide (an upstream delete). never unhides.

export const META_FIELDS = ["name", "description", "sportType", "hidden"] as const;
export type MetaField = (typeof META_FIELDS)[number];

// iso timestamps of the last site edit of each field
export type SiteEditTimes = Partial<Record<MetaField, string>>;

export interface MetaValues {
  name: string;
  description: string | null;
  sportType: string;
  hidden: boolean;
}

// what an upstream reports; undefined = the upstream doesn't say
export interface UpstreamValues {
  name?: string | null;
  description?: string | null;
  sportType?: string | null;
  hidden?: boolean;
}

export interface UpstreamSnapshot {
  provider: string;
  externalId: string;
  name: string | null;
  description: string | null;
  sportType: string | null;
  hidden: boolean;
  seenAt: string; // iso: when these values were observed
}

export type SkipReason = "first-sighting" | "unchanged" | "site-newer" | "site-set-sport" | "empty" | "never-unhide";

export interface MergeResult {
  updates: Partial<MetaValues>;
  snapshot: UpstreamSnapshot;
  applied: MetaField[];
  skipped: { field: MetaField; reason: SkipReason }[];
}

export function normalizeUpstream(u: UpstreamValues): UpstreamValues {
  const text = (s: string | null | undefined) => (s === undefined ? undefined : s?.trim() || null);
  return {
    name: text(u.name),
    description: text(u.description),
    sportType: text(u.sportType),
    hidden: u.hidden,
  };
}

const ms = (iso: string | undefined | null) => (iso ? Date.parse(iso) : NaN);

export function mergeUpstreamMeta(input: {
  current: MetaValues;
  siteEdits: SiteEditTimes | null;
  previous: UpstreamSnapshot | null;
  upstream: UpstreamValues;
  provider: string;
  externalId: string;
  changedAt: Date | null; // webhook event time; null when unknown (daily pull)
  now: Date;
}): MergeResult {
  const { current, previous, now, changedAt } = input;
  const site = input.siteEdits ?? {};
  const up = normalizeUpstream(input.upstream);
  // a snapshot of another provider identity is no baseline for this one
  const prev = previous && previous.provider === input.provider && previous.externalId === input.externalId ? previous : null;

  const snapshot: UpstreamSnapshot = {
    provider: input.provider,
    externalId: input.externalId,
    name: up.name !== undefined ? up.name : (prev?.name ?? null),
    description: up.description !== undefined ? up.description : (prev?.description ?? null),
    sportType: up.sportType !== undefined ? up.sportType : (prev?.sportType ?? null),
    hidden: up.hidden !== undefined ? up.hidden : (prev?.hidden ?? false),
    seenAt: now.toISOString(),
  };

  const result: MergeResult = { updates: {}, snapshot, applied: [], skipped: [] };
  const skip = (field: MetaField, reason: SkipReason) => result.skipped.push({ field, reason });

  // did the upstream change happen after the site's edit of this field?
  const upstreamIsNewer = (field: MetaField): boolean => {
    const siteAt = ms(site[field]);
    if (Number.isNaN(siteAt)) return true;
    if (changedAt) return changedAt.getTime() > siteAt;
    // unknown change time: somewhere after the previous snapshot
    const prevAt = ms(prev?.seenAt);
    return !Number.isNaN(prevAt) && siteAt < prevAt;
  };

  for (const field of META_FIELDS) {
    const value = up[field];
    if (value === undefined) continue;

    if (field === "hidden") {
      // hidden has a natural baseline (visible), so an upstream delete counts
      // even on the first sighting
      const before = prev?.hidden ?? false;
      if (value === before) skip(field, "unchanged");
      else if (value === false) skip(field, "never-unhide");
      else if (current.hidden) skip(field, "unchanged");
      else if (!upstreamIsNewer(field)) skip(field, "site-newer");
      else {
        result.updates.hidden = true;
        result.applied.push(field);
      }
      continue;
    }

    if (!prev) {
      skip(field, "first-sighting");
      continue;
    }
    const before = prev[field];
    if (value === before) {
      skip(field, "unchanged");
      continue;
    }
    // names and types never go blank; a cleared description is a real edit
    if (value === null && field !== "description") {
      skip(field, "empty");
      continue;
    }
    if (current[field] === value) {
      skip(field, "unchanged");
      continue;
    }
    if (field === "sportType" && site.sportType) {
      skip(field, "site-set-sport");
      continue;
    }
    if (!upstreamIsNewer(field)) {
      skip(field, "site-newer");
      continue;
    }
    (result.updates as Record<string, unknown>)[field] = value;
    result.applied.push(field);
  }
  return result;
}

// the site-edit times after an admin edit: every field whose value changed
// gets `at`; unchanged fields keep their previous time
export function recordSiteEdits(
  previous: SiteEditTimes | null,
  before: MetaValues,
  after: Partial<MetaValues>,
  at: Date
): SiteEditTimes {
  const next: SiteEditTimes = { ...(previous ?? {}) };
  for (const field of META_FIELDS) {
    const value = after[field];
    if (value === undefined) continue;
    if (value !== before[field]) next[field] = at.toISOString();
  }
  return next;
}
