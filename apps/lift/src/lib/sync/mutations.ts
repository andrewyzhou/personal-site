// outbox rows -> push request, and the server's ack -> what to mark synced.
// pure: no expo or sqlite imports so it runs under vitest.

import {
  SYNC_ENTITIES,
  SYNC_PROTOCOL_VERSION,
  type SyncEntity,
  type SyncMutation,
  type SyncOp,
  type SyncPushRequest,
  type SyncPushResponse,
} from "lift-core";

/** the outbox columns the push needs */
export interface OutboxLike {
  id: number;
  entity: string;
  entityId: string;
  op: string;
  payload: string;
  createdAt: number;
}

const ENTITIES = new Set<string>(SYNC_ENTITIES);
const OPS = new Set<string>(["insert", "update", "delete"]);

export function toMutation(row: OutboxLike): SyncMutation {
  if (!ENTITIES.has(row.entity)) throw new Error(`outbox row ${row.id}: unknown entity ${row.entity}`);
  if (!OPS.has(row.op)) throw new Error(`outbox row ${row.id}: unknown op ${row.op}`);
  const op = row.op as SyncOp;
  // deletes only carry the id locally; the contract wants null
  const payload = op === "delete" ? null : (JSON.parse(row.payload) as SyncMutation["payload"]);
  return { seq: row.id, entity: row.entity as SyncEntity, id: row.entityId, op, payload, at: row.createdAt };
}

export function buildPushRequest(deviceId: string, rows: readonly OutboxLike[]): SyncPushRequest {
  return { protocol: SYNC_PROTOCOL_VERSION, deviceId, mutations: rows.map(toMutation) };
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** validates a 200 body; null when it isn't a push response */
export function parsePushResponse(body: unknown): SyncPushResponse | null {
  if (!isObj(body) || body.ok !== true) return null;
  if (typeof body.appliedThrough !== "number" || !Number.isFinite(body.appliedThrough)) return null;
  const rejected: SyncPushResponse["rejected"] = [];
  if (Array.isArray(body.rejected)) {
    for (const r of body.rejected) {
      if (isObj(r) && typeof r.seq === "number") {
        rejected.push({ seq: r.seq, reason: typeof r.reason === "string" ? r.reason : "rejected" });
      }
    }
  }
  return {
    ok: true,
    appliedThrough: body.appliedThrough,
    applied: typeof body.applied === "number" ? body.applied : 0,
    skipped: typeof body.skipped === "number" ? body.skipped : 0,
    rejected,
  };
}

export interface AckPlan {
  /** mark unsynced outbox rows with id <= this as synced; null = nothing */
  syncedThrough: number | null;
  /** reasons to store on rows the server refused (all within syncedThrough) */
  rejected: { seq: number; reason: string }[];
  /** false when the server acked none of the batch: stop instead of resending forever */
  progressed: boolean;
}

export function planAck(sentSeqs: readonly number[], res: SyncPushResponse): AckPlan {
  if (sentSeqs.length === 0) return { syncedThrough: null, rejected: [], progressed: false };
  const first = Math.min(...sentSeqs);
  const last = Math.max(...sentSeqs);
  // never past what we sent: a row the server never saw must stay unsynced
  const through = Math.min(res.appliedThrough, last);
  if (through < first) return { syncedThrough: null, rejected: [], progressed: false };
  const sent = new Set(sentSeqs);
  const rejected = res.rejected.filter((r) => sent.has(r.seq) && r.seq <= through);
  return { syncedThrough: through, rejected, progressed: true };
}

/** "https://x.org/" + "/api/lift/sync" -> "https://x.org/api/lift/sync"; null for non-http urls */
export function endpoint(base: string, path: string): string | null {
  const b = base.trim().replace(/\/+$/, "");
  if (!/^https?:\/\/[^/\s]+/i.test(b)) return null;
  return b + (path.startsWith("/") ? path : `/${path}`);
}
