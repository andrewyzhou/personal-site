// the durable sync log (table sync_events). every external call the sync code
// makes goes through syncFetch; every import/merge/update decision is one
// syncEvent. events are buffered per run and written in batches; a failed
// write falls back to the console and never breaks the sync. a dry run prints
// its events instead of writing them. server-only.

import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { and, eq, lt } from "drizzle-orm";
import { getDb } from "./db";
import { syncEvents } from "./db/sync-schema";

export type SyncTrigger = "cron" | "poll" | "manual" | "telegram" | "webhook" | "script";
export type SyncKind =
  | "api_call"
  | "insert"
  | "merge"
  | "attach"
  | "update_field"
  | "skip"
  | "error"
  | "run_start"
  | "run_end";

export interface SyncEvent {
  at: Date;
  runId: string;
  trigger: SyncTrigger;
  source: string;
  kind: SyncKind;
  activityId: number | null;
  externalId: string | null;
  detail: Record<string, unknown> | null;
  durationMs: number | null;
}

export interface SyncEventInput {
  source: string;
  kind: SyncKind;
  activityId?: number | null;
  externalId?: string | null;
  detail?: Record<string, unknown>;
  durationMs?: number | null;
  // only used outside a run (the event is then its own one-event run)
  trigger?: SyncTrigger;
}

export interface SyncRun {
  runId: string;
  trigger: SyncTrigger;
  dryRun: boolean;
  events: SyncEvent[];
}

const FLUSH_AT = 100; // a run that is killed mid-way loses at most this many
const INSERT_CHUNK = 200;
export const API_CALL_RETENTION_DAYS = 180;

const storage = new AsyncLocalStorage<SyncRun>();

export const currentRun = (): SyncRun | undefined => storage.getStore();
export const isDryRun = (): boolean => storage.getStore()?.dryRun === true;

function toEvent(run: Pick<SyncRun, "runId" | "trigger">, e: SyncEventInput): SyncEvent {
  return {
    at: new Date(),
    runId: run.runId,
    trigger: run.trigger,
    source: e.source,
    kind: e.kind,
    activityId: e.activityId ?? null,
    externalId: e.externalId ?? null,
    detail: e.detail ?? null,
    durationMs: e.durationMs == null ? null : Math.round(e.durationMs),
  };
}

// one compact line per event (the cli and the console fallback)
export function formatEvent(e: {
  at: Date;
  runId: string;
  trigger: string;
  source: string;
  kind: string;
  activityId: number | null;
  externalId: string | null;
  detail: Record<string, unknown> | null;
  durationMs: number | null;
}): string {
  const parts = [
    e.at.toISOString().replace("T", " ").slice(0, 19),
    e.runId.slice(0, 8),
    e.trigger,
    e.source,
    e.kind,
  ];
  if (e.activityId != null) parts.push(`#${e.activityId}`);
  if (e.externalId) parts.push(`ext=${e.externalId}`);
  if (e.durationMs != null) parts.push(`${e.durationMs}ms`);
  if (e.detail && Object.keys(e.detail).length > 0) parts.push(JSON.stringify(e.detail));
  return parts.join(" ");
}

async function writeEvents(events: SyncEvent[], dryRun: boolean): Promise<void> {
  if (events.length === 0) return;
  if (dryRun) {
    for (const e of events) console.log(`[dry run] ${formatEvent(e)}`);
    return;
  }
  try {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
    const db = getDb();
    for (let i = 0; i < events.length; i += INSERT_CHUNK) {
      await db.insert(syncEvents).values(events.slice(i, i + INSERT_CHUNK));
    }
  } catch (error) {
    if (process.env.DATABASE_URL) console.warn(`sync-log: write failed (${(error as Error).message}); ${events.length} events follow`);
    for (const e of events) console.log(`sync-log ${formatEvent(e)}`);
  }
}

async function flush(run: SyncRun): Promise<void> {
  const batch = run.events.splice(0, run.events.length);
  await writeEvents(batch, run.dryRun);
}

// record one event. inside a run it is buffered; outside one (a lift share
// arriving on its own) it is written at once. never throws.
export async function syncEvent(e: SyncEventInput): Promise<void> {
  try {
    const run = storage.getStore();
    if (!run) {
      await writeEvents([toEvent({ runId: randomUUID(), trigger: e.trigger ?? "manual" }, e)], false);
      return;
    }
    run.events.push(toEvent(run, e));
    if (run.events.length >= FLUSH_AT) await flush(run);
  } catch (error) {
    console.warn(`sync-log: dropped an event (${(error as Error).message})`);
  }
}

// run `fn` as one logged run: run_start, its events, run_end, one flush. a
// call inside an existing run joins it (no second start/end).
export async function withSyncRun<T>(
  opts: { trigger: SyncTrigger; source: string; dryRun?: boolean },
  fn: (run: SyncRun) => Promise<T>
): Promise<T> {
  const existing = storage.getStore();
  if (existing) return fn(existing);
  const run: SyncRun = { runId: randomUUID(), trigger: opts.trigger, dryRun: opts.dryRun ?? false, events: [] };
  const started = Date.now();
  return storage.run(run, async () => {
    await syncEvent({ source: opts.source, kind: "run_start", detail: run.dryRun ? { dryRun: true } : undefined });
    try {
      const result = await fn(run);
      await syncEvent({ source: opts.source, kind: "run_end", durationMs: Date.now() - started, detail: summarize(result) });
      return result;
    } catch (error) {
      await syncEvent({ source: opts.source, kind: "error", detail: { message: (error as Error).message } });
      await syncEvent({ source: opts.source, kind: "run_end", durationMs: Date.now() - started, detail: { failed: true } });
      throw error;
    } finally {
      await flush(run);
    }
  });
}

// a small, json-safe copy of a run's result for run_end
function summarize(result: unknown): Record<string, unknown> | undefined {
  if (!result || typeof result !== "object") return undefined;
  try {
    const text = JSON.stringify(result);
    return text.length <= 4000 ? (JSON.parse(text) as Record<string, unknown>) : { truncated: text.slice(0, 4000) };
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// external calls

// a 429/5xx (or a network failure): the source is skipped for this run, no
// retries. callers let it propagate out of their per-item loops.
export class UpstreamUnavailableError extends Error {
  constructor(
    readonly source: string,
    readonly status: number | null,
    message: string
  ) {
    super(message);
    this.name = "UpstreamUnavailableError";
  }
}

export function throwIfUnavailable(response: Response, source: string): void {
  if (response.status === 429 || response.status >= 500) {
    throw new UpstreamUnavailableError(source, response.status, `${source} answered ${response.status}`);
  }
}

const SECRET_PARAM = /token|key|secret|code|pass|auth|sig|session|cookie|refresh/i;

// method + host + path for the log: query values that could be secrets are
// redacted, everything else kept so a call can be reproduced
export function redactUrl(url: string): { host: string; path: string } {
  try {
    const u = new URL(url);
    const params = [...u.searchParams.entries()].map(([k, v]) => `${k}=${SECRET_PARAM.test(k) ? "[redacted]" : v}`);
    return { host: u.host, path: u.pathname + (params.length ? `?${params.join("&")}` : "") };
  } catch {
    return { host: "?", path: "?" };
  }
}

const NULL_BODY = new Set([101, 204, 205, 304]);

// fetch, logged as one api_call event (method, host, path, status, duration,
// bytes). the body is read here so its size is known; the caller gets an
// equivalent response. headers and request bodies are never logged.
export async function syncFetch(source: string, url: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  const { host, path } = redactUrl(url);
  const started = Date.now();
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    const message = (error as Error).message;
    await syncEvent({ source, kind: "api_call", durationMs: Date.now() - started, detail: { method, host, path, status: null, error: message } });
    throw new UpstreamUnavailableError(source, null, `${source} unreachable: ${message}`);
  }
  let body: ArrayBuffer | null = null;
  try {
    body = NULL_BODY.has(response.status) ? null : await response.arrayBuffer();
  } catch (error) {
    const message = (error as Error).message;
    await syncEvent({ source, kind: "api_call", durationMs: Date.now() - started, detail: { method, host, path, status: response.status, error: message } });
    throw new UpstreamUnavailableError(source, null, `${source} body failed: ${message}`);
  }
  await syncEvent({
    source,
    kind: "api_call",
    durationMs: Date.now() - started,
    detail: { method, host, path, status: response.status, bytes: body?.byteLength ?? 0 },
  });
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}

// a fetch-compatible function for clients that take one (the spotify collector)
export function loggedFetch(source: string): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    return syncFetch(source, url, init);
  }) as typeof fetch;
}

// ---------------------------------------------------------------------------
// retention + reading

// api_call rows go after 180 days; decisions and errors are kept for good
export async function pruneApiCalls(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - API_CALL_RETENTION_DAYS * 86400000);
  const rows = await getDb()
    .delete(syncEvents)
    .where(and(eq(syncEvents.kind, "api_call"), lt(syncEvents.at, cutoff)))
    .returning({ id: syncEvents.id });
  return rows.length;
}

// "2d", "6h", "30m", or an iso date → the instant it names
export function parseSince(value: string, now = new Date()): Date | null {
  const m = /^(\d+)\s*([mhdw])$/i.exec(value.trim());
  if (m) {
    const unit = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 }[m[2].toLowerCase() as "m" | "h" | "d" | "w"];
    return new Date(now.getTime() - Number(m[1]) * unit);
  }
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : new Date(t);
}
