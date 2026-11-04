// the push loop. storage and network are injected so tests can drive it.

import { SYNC_MAX_BATCH, type SyncPushResponse } from "lift-core";
import { buildPushRequest, endpoint, parsePushResponse, planAck, type AckPlan, type OutboxLike } from "./mutations";

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }
) => Promise<{ status: number; json(): Promise<unknown> }>;

export interface PushDeps {
  fetch: FetchLike;
  baseUrl: string;
  token: string;
  deviceId: string;
  /** unsynced outbox rows in id order, at most `limit` */
  readBatch(limit: number): OutboxLike[];
  /** apply the ack in one local transaction */
  ack(plan: AckPlan): void;
  maxBatch?: number;
  /** guard against a server that keeps acking one row at a time forever */
  maxRounds?: number;
  timeoutMs?: number;
}

export interface PushStats {
  pushed: number;
  applied: number;
  skipped: number;
  rejected: number;
  rounds: number;
}

/** why a push stopped, so the ui can say something specific */
export type PushErrorKind = "config" | "unauthorized" | "bad_request" | "too_large" | "server" | "network" | "protocol";

export type PushResult =
  | ({ ok: true } & PushStats)
  | ({ ok: false; error: string; kind: PushErrorKind; status?: number } & PushStats);

type PostOutcome = { res: SyncPushResponse } | { error: string; kind: PushErrorKind; status?: number };

async function serverError(r: { json(): Promise<unknown> }): Promise<string | null> {
  try {
    const body = (await r.json()) as { error?: unknown } | null;
    return typeof body?.error === "string" ? body.error.slice(0, 200) : null;
  } catch {
    return null;
  }
}

async function postOnce(deps: PushDeps, url: string, body: string): Promise<PostOutcome> {
  const controller = typeof AbortController === "undefined" ? null : new AbortController();
  const timer = controller ? setTimeout(() => controller.abort(), deps.timeoutMs ?? 30_000) : null;
  try {
    const r = await deps.fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${deps.token}` },
      body,
      signal: controller?.signal,
    });
    if (r.status === 401 || r.status === 403) {
      return { error: "unauthorized: check the app token", kind: "unauthorized", status: r.status };
    }
    if (r.status === 413) return { error: "batch too large for the server", kind: "too_large", status: 413 };
    if (r.status === 400) {
      const why = await serverError(r);
      return { error: `server refused the batch${why ? `: ${why}` : ""}`, kind: "bad_request", status: 400 };
    }
    if (r.status !== 200) return { error: `server error ${r.status}`, kind: "server", status: r.status };
    let json: unknown;
    try {
      json = await r.json();
    } catch {
      return { error: "bad response from server", kind: "protocol", status: r.status };
    }
    const res = parsePushResponse(json);
    if (!res) return { error: "bad response from server", kind: "protocol", status: r.status };
    return { res };
  } catch (e) {
    return { error: e instanceof Error && e.name === "AbortError" ? "timed out" : "network error", kind: "network" };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** pushes until the outbox is drained or something fails; rows are only marked after a 200 */
export async function pushAll(deps: PushDeps): Promise<PushResult> {
  const stats: PushStats = { pushed: 0, applied: 0, skipped: 0, rejected: 0, rounds: 0 };
  const url = endpoint(deps.baseUrl, "/api/lift/sync");
  if (!url) return { ok: false, error: "invalid server url", kind: "config", ...stats };
  if (!deps.token) return { ok: false, error: "no app token", kind: "config", ...stats };
  // shrinks on 413 and stays small for the rest of this push
  let size = Math.max(1, Math.min(deps.maxBatch ?? SYNC_MAX_BATCH, SYNC_MAX_BATCH));
  const maxRounds = deps.maxRounds ?? 1000;

  while (stats.rounds < maxRounds) {
    const rows = deps.readBatch(size);
    if (rows.length === 0) return { ok: true, ...stats };
    let body: string;
    try {
      body = JSON.stringify(buildPushRequest(deps.deviceId, rows));
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "bad outbox row", kind: "protocol", ...stats };
    }
    stats.rounds++;
    const out = await postOnce(deps, url, body);
    if ("error" in out) {
      // halve and retry; a single row that is still too large can't be split further
      if (out.kind === "too_large" && rows.length > 1) {
        size = Math.max(1, Math.floor(rows.length / 2));
        continue;
      }
      if (out.kind === "too_large") {
        return { ok: false, ...out, error: `change ${rows[0].id} is too large for the server`, ...stats };
      }
      return { ok: false, ...out, ...stats };
    }
    const plan = planAck(
      rows.map((r) => r.id),
      out.res
    );
    if (!plan.progressed) return { ok: false, error: "server did not accept the batch", kind: "protocol", ...stats };
    deps.ack(plan);
    stats.pushed += plan.seqs.length;
    stats.applied += out.res.applied;
    stats.skipped += out.res.skipped;
    stats.rejected += plan.rejected.length;
  }
  return { ok: false, error: "too many rounds", kind: "protocol", ...stats };
}
