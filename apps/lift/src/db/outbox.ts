import { outbox, type OutboxEntity, type OutboxOp } from "./schema";
import type { Tx } from "./client";

/**
 * append a change record in the caller's transaction. payload is the full row
 * after the write (or just the id for deletes) so the sync can push it as-is.
 */
export function writeOutbox(tx: Tx, entity: OutboxEntity, entityId: string, op: OutboxOp, payload: unknown): void {
  tx.insert(outbox)
    .values({ entity, entityId, op, payload: JSON.stringify(payload), createdAt: Date.now() })
    .run();
}
