// listening stats: pure functions over plays already loaded from the db.
// no io here so the same code serves pages, scripts and tests.

export const DEFAULT_LISTENING_TIMEZONE = "America/Los_Angeles";

export interface StatPlay {
  playedAt: Date;
  startedAt: Date | null;
  msPlayed: number | null;
  skipped: boolean | null;
  itemType: string;
  trackId: string | null;
  trackName: string | null;
  artistIds: string[];
  artistNames: string[]; // first = primary artist
  albumId: string | null;
  albumName: string | null;
  genres: string[]; // union of the play's artists' genres
}

export type Period = "day" | "week" | "month" | "year";

export interface PeriodTotal {
  period: string;
  plays: number;
  msPlayed: number;
}

export interface TopEntry {
  id: string;
  name: string;
  plays: number;
  msPlayed: number;
}

export interface TopOptions {
  by?: "ms" | "plays";
  limit?: number;
}

export interface SkipRate {
  known: number;
  skipped: number;
  rate: number | null;
}

export interface HeatCell {
  plays: number;
  msPlayed: number;
}

export interface Streaks {
  current: number;
  longest: number;
  longestStart: string | null;
  longestEnd: string | null;
}

export interface DiscoveryPeriod {
  period: string;
  artists: number;
  newArtists: number;
  rate: number | null;
}

export interface GenreMixPeriod {
  period: string;
  msPlayed: number;
  genres: Record<string, number>;
}

export interface ListeningDay {
  date: string; // YYYY-MM-DD, local
  minutes: number;
  plays: number;
  topArtist: string | null;
}

export interface StatActivity {
  id: number;
  startDateUtc: Date;
  elapsedTimeS: number;
  sportType?: string;
}

export interface ActivityTrack {
  trackId: string | null;
  trackName: string | null;
  overlapMs: number;
}

export interface ActivityListening {
  activityId: number;
  plays: number;
  overlapMs: number;
  topArtist: string | null;
  tracks: ActivityTrack[];
}

// ---- local time ----

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  dow: number; // 0 = monday
}

const formatters = new Map<string, Intl.DateTimeFormat>();
const WEEKDAYS: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      weekday: "short",
      hourCycle: "h23",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

function localParts(d: Date, timeZone: string): LocalParts {
  const out: Record<string, string> = {};
  for (const p of formatterFor(timeZone).formatToParts(d)) out[p.type] = p.value;
  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
    // some engines print midnight as 24 even with h23
    hour: Number(out.hour) % 24,
    dow: WEEKDAYS[out.weekday] ?? 0,
  };
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

function dateKey(p: { year: number; month: number; day: number }): string {
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
}

function isoWeekKey(p: { year: number; month: number; day: number }): string {
  // the iso year is the year of the thursday in the same monday-based week
  const t = new Date(Date.UTC(p.year, p.month - 1, p.day));
  const dow = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - dow + 3);
  const isoYear = t.getUTCFullYear();
  const jan1 = Date.UTC(isoYear, 0, 1);
  const week = Math.floor((t.getTime() - jan1) / 86_400_000 / 7) + 1;
  return `${pad(isoYear, 4)}-W${pad(week)}`;
}

function periodKey(d: Date, period: Period, timeZone: string): string {
  const p = localParts(d, timeZone);
  switch (period) {
    case "day":
      return dateKey(p);
    case "week":
      return isoWeekKey(p);
    case "month":
      return `${pad(p.year, 4)}-${pad(p.month)}`;
    case "year":
      return pad(p.year, 4);
  }
}

export function localDate(d: Date, timeZone: string = DEFAULT_LISTENING_TIMEZONE): string {
  return dateKey(localParts(d, timeZone));
}

function dayNumber(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

function dayString(n: number): string {
  return new Date(n * 86_400_000).toISOString().slice(0, 10);
}

// ---- keys ----

const ms = (p: StatPlay) => p.msPlayed ?? 0;
const nameKey = (...parts: (string | null | undefined)[]) =>
  "name:" + parts.map((s) => (s ?? "").trim().toLowerCase()).join("|");

function primaryArtist(p: StatPlay): { id: string; name: string } | null {
  const name = p.artistNames[0] ?? null;
  const id = p.artistIds[0] ?? (name ? nameKey(name) : null);
  if (!id) return null;
  return { id, name: name ?? id };
}

// every credited artist; basic exports only carry names, so key by name then
function allArtists(p: StatPlay): { id: string; name: string }[] {
  const n = Math.max(p.artistIds.length, p.artistNames.length);
  const out: { id: string; name: string }[] = [];
  for (let i = 0; i < n; i++) {
    const name = p.artistNames[i] ?? null;
    const id = p.artistIds[i] ?? (name ? nameKey(name) : null);
    if (id) out.push({ id, name: name ?? id });
  }
  return out;
}

// track and album names repeat across artists, so the fallback includes the artist
function trackKey(p: StatPlay): { id: string; name: string } | null {
  if (p.trackId) return { id: p.trackId, name: p.trackName ?? p.trackId };
  if (!p.trackName) return null;
  return { id: nameKey(p.trackName, p.artistNames[0]), name: p.trackName };
}

function albumKey(p: StatPlay): { id: string; name: string } | null {
  if (p.albumId) return { id: p.albumId, name: p.albumName ?? p.albumId };
  if (!p.albumName) return null;
  return { id: nameKey(p.albumName, p.artistNames[0]), name: p.albumName };
}

// ---- totals ----

export function totalsBy(
  plays: StatPlay[],
  period: Period,
  timeZone: string = DEFAULT_LISTENING_TIMEZONE
): PeriodTotal[] {
  const map = new Map<string, PeriodTotal>();
  for (const p of plays) {
    const k = periodKey(p.playedAt, period, timeZone);
    const t = map.get(k) ?? { period: k, plays: 0, msPlayed: 0 };
    t.plays++;
    t.msPlayed += ms(p);
    map.set(k, t);
  }
  return [...map.values()].sort((a, b) => (a.period < b.period ? -1 : a.period > b.period ? 1 : 0));
}

// ---- top lists ----

function rank(
  plays: StatPlay[],
  keyOf: (p: StatPlay) => { id: string; name: string } | null,
  { by = "ms", limit = 10 }: TopOptions
): TopEntry[] {
  const map = new Map<string, TopEntry>();
  for (const p of plays) {
    const k = keyOf(p);
    if (!k) continue;
    const e = map.get(k.id) ?? { id: k.id, name: k.name, plays: 0, msPlayed: 0 };
    e.plays++;
    e.msPlayed += ms(p);
    map.set(k.id, e);
  }
  const primary = by === "ms" ? "msPlayed" : "plays";
  const secondary = by === "ms" ? "plays" : "msPlayed";
  return [...map.values()]
    .sort(
      (a, b) =>
        b[primary] - a[primary] ||
        b[secondary] - a[secondary] ||
        a.name.localeCompare(b.name) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    )
    .slice(0, limit);
}

export function topTracks(plays: StatPlay[], opts: TopOptions = {}): TopEntry[] {
  return rank(plays, trackKey, opts);
}

// credits the primary (first) artist only, so features don't inflate a guest artist
export function topArtists(plays: StatPlay[], opts: TopOptions = {}): TopEntry[] {
  return rank(plays, primaryArtist, opts);
}

export function topAlbums(plays: StatPlay[], opts: TopOptions = {}): TopEntry[] {
  return rank(plays, albumKey, opts);
}

// ---- skips ----

export function skipRate(plays: StatPlay[]): SkipRate {
  let known = 0;
  let skipped = 0;
  for (const p of plays) {
    if (p.skipped === null) continue;
    known++;
    if (p.skipped) skipped++;
  }
  return { known, skipped, rate: known ? skipped / known : null };
}

// ---- heatmap ----

export function heatmap(plays: StatPlay[], timeZone: string = DEFAULT_LISTENING_TIMEZONE): HeatCell[][] {
  const grid: HeatCell[][] = Array.from({ length: 7 }, () =>
    Array.from({ length: 24 }, () => ({ plays: 0, msPlayed: 0 }))
  );
  for (const p of plays) {
    const lp = localParts(p.playedAt, timeZone);
    const cell = grid[lp.dow][lp.hour];
    cell.plays++;
    cell.msPlayed += ms(p);
  }
  return grid;
}

// ---- streaks ----

export function streaks(
  plays: StatPlay[],
  timeZone: string = DEFAULT_LISTENING_TIMEZONE,
  today: string = localDate(new Date(), timeZone)
): Streaks {
  const days = [...new Set(plays.map((p) => dayNumber(localDate(p.playedAt, timeZone))))].sort((a, b) => a - b);
  if (!days.length) return { current: 0, longest: 0, longestStart: null, longestEnd: null };

  let longest = 0;
  let longestStart = days[0];
  let runStart = days[0];
  for (let i = 0; i < days.length; i++) {
    if (i > 0 && days[i] !== days[i - 1] + 1) runStart = days[i];
    const len = days[i] - runStart + 1;
    // strict > keeps the earliest of equally long streaks
    if (len > longest) {
      longest = len;
      longestStart = runStart;
    }
  }

  const t = dayNumber(today);
  const set = new Set(days);
  let cursor = set.has(t) ? t : set.has(t - 1) ? t - 1 : null;
  let current = 0;
  while (cursor !== null && set.has(cursor)) {
    current++;
    cursor--;
  }

  return {
    current,
    longest,
    longestStart: dayString(longestStart),
    longestEnd: dayString(longestStart + longest - 1),
  };
}

// ---- discovery ----

export function firstHeard(plays: StatPlay[], kind: "track" | "artist"): Map<string, Date> {
  const out = new Map<string, Date>();
  const note = (id: string, at: Date) => {
    const prev = out.get(id);
    if (!prev || at < prev) out.set(id, at);
  };
  for (const p of plays) {
    if (kind === "track") {
      const k = trackKey(p);
      if (k) note(k.id, p.playedAt);
    } else {
      for (const a of allArtists(p)) note(a.id, p.playedAt);
    }
  }
  return out;
}

// counts every credited artist, so a first feature counts as a discovery
export function discoveryRate(
  plays: StatPlay[],
  period: Period,
  timeZone: string = DEFAULT_LISTENING_TIMEZONE
): DiscoveryPeriod[] {
  const first = firstHeard(plays, "artist");
  const firstPeriod = new Map<string, string>();
  for (const [id, at] of first) firstPeriod.set(id, periodKey(at, period, timeZone));

  const seen = new Map<string, Set<string>>();
  for (const p of plays) {
    const k = periodKey(p.playedAt, period, timeZone);
    let s = seen.get(k);
    if (!s) seen.set(k, (s = new Set()));
    for (const a of allArtists(p)) s.add(a.id);
  }

  return [...seen.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, s]) => {
      let fresh = 0;
      for (const id of s) if (firstPeriod.get(id) === k) fresh++;
      return { period: k, artists: s.size, newArtists: fresh, rate: s.size ? fresh / s.size : null };
    });
}

// ---- genres ----

// a play's ms is split evenly across its genres so each period sums to its listening time
export function genreMix(
  plays: StatPlay[],
  period: Period,
  timeZone: string = DEFAULT_LISTENING_TIMEZONE,
  { top = 8 }: { top?: number } = {}
): GenreMixPeriod[] {
  const shares = (p: StatPlay): [string, number][] => {
    const g = [...new Set(p.genres)];
    if (!g.length) return [["unknown", ms(p)]];
    return g.map((name) => [name, ms(p) / g.length]);
  };

  const overall = new Map<string, number>();
  for (const p of plays) {
    if (!p.genres.length) continue;
    for (const [g, v] of shares(p)) overall.set(g, (overall.get(g) ?? 0) + v);
  }
  const kept = new Set(
    [...overall.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, top)
      .map(([g]) => g)
  );

  const byPeriod = new Map<string, GenreMixPeriod>();
  for (const p of plays) {
    const k = periodKey(p.playedAt, period, timeZone);
    const row = byPeriod.get(k) ?? { period: k, msPlayed: 0, genres: {} };
    row.msPlayed += ms(p);
    for (const [g, v] of shares(p)) {
      const bucket = g === "unknown" && !p.genres.length ? "unknown" : kept.has(g) ? g : "other";
      row.genres[bucket] = (row.genres[bucket] ?? 0) + v;
    }
    byPeriod.set(k, row);
  }
  return [...byPeriod.values()].sort((a, b) => (a.period < b.period ? -1 : a.period > b.period ? 1 : 0));
}

// ---- calendar ----

export function listeningByDay(plays: StatPlay[], timeZone: string = DEFAULT_LISTENING_TIMEZONE): ListeningDay[] {
  const days = new Map<string, { ms: number; plays: number; artists: Map<string, { name: string; ms: number; plays: number }> }>();
  for (const p of plays) {
    const date = localDate(p.playedAt, timeZone);
    let d = days.get(date);
    if (!d) days.set(date, (d = { ms: 0, plays: 0, artists: new Map() }));
    d.ms += ms(p);
    d.plays++;
    const a = primaryArtist(p);
    if (a) {
      const e = d.artists.get(a.id) ?? { name: a.name, ms: 0, plays: 0 };
      e.ms += ms(p);
      e.plays++;
      d.artists.set(a.id, e);
    }
  }
  return [...days.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, d]) => {
      let best: { name: string; ms: number; plays: number } | null = null;
      for (const e of d.artists.values()) {
        if (!best || e.ms > best.ms || (e.ms === best.ms && (e.plays > best.plays || (e.plays === best.plays && e.name.localeCompare(best.name) < 0)))) best = e;
      }
      return { date, minutes: Math.round(d.ms / 6_000) / 10, plays: d.plays, topArtist: best?.name ?? null };
    });
}

// ---- activities ----

// read-only and private: joins listening to activities for the owner's views only,
// never for a public page
export function playsDuringActivities(plays: StatPlay[], activities: StatActivity[]): ActivityListening[] {
  const intervals = plays
    .map((p) => {
      const end = p.playedAt.getTime();
      const start = p.startedAt ? p.startedAt.getTime() : end - ms(p);
      return { p, start: Math.min(start, end), end };
    })
    .sort((a, b) => a.start - b.start);
  const acts = activities
    .map((a) => {
      const start = a.startDateUtc.getTime();
      return { a, start, end: start + Math.max(0, a.elapsedTimeS) * 1000 };
    })
    .sort((a, b) => a.start - b.start || a.a.id - b.a.id);

  const out: ActivityListening[] = [];
  let next = 0;
  let active: typeof intervals = [];
  for (const act of acts) {
    while (next < intervals.length && intervals[next].start < act.end) active.push(intervals[next++]);
    // activities come in start order, so a play that ended before this one can't touch later ones
    active = active.filter((iv) => iv.end > act.start);

    let count = 0;
    let total = 0;
    const tracks = new Map<string, ActivityTrack>();
    const artists = new Map<string, { name: string; ms: number }>();
    for (const iv of active) {
      const overlap = Math.min(iv.end, act.end) - Math.max(iv.start, act.start);
      if (overlap <= 0) continue;
      count++;
      total += overlap;
      const tk = trackKey(iv.p)?.id ?? `play:${iv.start}`;
      const t = tracks.get(tk) ?? { trackId: iv.p.trackId, trackName: iv.p.trackName, overlapMs: 0 };
      t.overlapMs += overlap;
      tracks.set(tk, t);
      const a = primaryArtist(iv.p);
      if (a) {
        const e = artists.get(a.id) ?? { name: a.name, ms: 0 };
        e.ms += overlap;
        artists.set(a.id, e);
      }
    }
    if (!count) continue;

    let topArtist: string | null = null;
    let topMs = -1;
    for (const e of artists.values()) {
      if (e.ms > topMs || (e.ms === topMs && topArtist !== null && e.name.localeCompare(topArtist) < 0)) {
        topArtist = e.name;
        topMs = e.ms;
      }
    }
    out.push({
      activityId: act.a.id,
      plays: count,
      overlapMs: total,
      topArtist,
      tracks: [...tracks.values()].sort(
        (a, b) => b.overlapMs - a.overlapMs || (a.trackName ?? "").localeCompare(b.trackName ?? "")
      ),
    });
  }
  return out;
}
