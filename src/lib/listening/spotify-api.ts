// thin spotify web api client for the history collector: returns the exact
// response bytes (they go to the raw store before anything parses them),
// honors retry-after on 429 and refreshes the token once on 401.

export const API_BASE = "https://api.spotify.com/v1";

export interface SpotifyResponse {
  url: string;
  status: number;
  bytes: Uint8Array;
  fetchedAt: Date;
}

export interface SpotifyHttp {
  get(url: string): Promise<SpotifyResponse>;
}

export class SpotifyRateLimitError extends Error {
  constructor(public retryAfterS: number) {
    super(`spotify rate limited (retry after ${retryAfterS}s)`);
    this.name = "SpotifyRateLimitError";
  }
}

export class SpotifyHttpError extends Error {
  constructor(
    public status: number,
    public url: string,
    body: string
  ) {
    super(`spotify ${status} for ${url.replace(API_BASE, "")}: ${body.slice(0, 200)}`);
    this.name = "SpotifyHttpError";
  }
}

export interface SpotifyHttpOptions {
  getToken: (force?: boolean) => Promise<string>;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  // waits longer than this are not slept through: the run stops and the next
  // scheduled run picks up
  maxRetryAfterS?: number;
  maxRetries?: number;
  timeoutMs?: number;
}

export function parseRetryAfter(value: string | null): number {
  if (!value) return 1;
  const n = Number(value);
  if (Number.isFinite(n) && n >= 0) return Math.ceil(n);
  const date = Date.parse(value);
  if (!Number.isNaN(date)) return Math.max(0, Math.ceil((date - Date.now()) / 1000));
  return 1;
}

export function createSpotifyHttp(opts: SpotifyHttpOptions): SpotifyHttp {
  const doFetch = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const maxRetryAfterS = opts.maxRetryAfterS ?? 10;
  const maxRetries = opts.maxRetries ?? 3;
  const timeoutMs = opts.timeoutMs ?? 10_000;
  let token: string | null = null;

  return {
    async get(url) {
      let refreshed = false;
      for (let attempt = 0; ; attempt++) {
        if (!token) token = await opts.getToken(refreshed);
        const res = await doFetch(url, {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (res.status === 401 && !refreshed) {
          refreshed = true;
          token = null;
          continue;
        }
        if (res.status === 429) {
          const wait = parseRetryAfter(res.headers.get("retry-after"));
          if (wait > maxRetryAfterS || attempt >= maxRetries) throw new SpotifyRateLimitError(wait);
          await sleep(wait * 1000);
          continue;
        }
        if (res.status >= 500 && attempt < maxRetries) {
          await sleep(500 * 2 ** attempt);
          continue;
        }
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (res.status !== 200) {
          throw new SpotifyHttpError(res.status, url, new TextDecoder().decode(bytes));
        }
        return { url, status: res.status, bytes, fetchedAt: new Date() };
      }
    },
  };
}

export function recentlyPlayedUrl(opts: { after?: number; before?: number; limit?: number } = {}): string {
  const p = new URLSearchParams({ limit: String(opts.limit ?? 50) });
  if (opts.before !== undefined) p.set("before", String(opts.before));
  else if (opts.after !== undefined) p.set("after", String(opts.after));
  return `${API_BASE}/me/player/recently-played?${p.toString()}`;
}

// documented batch limits
export const TRACKS_BATCH = 50;
export const ARTISTS_BATCH = 50;
export const ALBUMS_BATCH = 20;

export function lookupUrl(kind: "tracks" | "artists" | "albums", ids: string[]): string {
  return `${API_BASE}/${kind}?ids=${ids.map(encodeURIComponent).join(",")}`;
}

export function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}
