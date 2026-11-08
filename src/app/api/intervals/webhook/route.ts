import { NextResponse, after } from "next/server";
import { createHash, timingSafeEqual } from "crypto";
import { revalidatePath } from "next/cache";
import { handleWebhookEvent, isIntervalsConfigured, parseWebhookEvents, type WebhookOutcome } from "@/lib/intervals";
import { log } from "@/lib/log";
import { syncEvent, withSyncRun } from "@/lib/sync-log";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BODY_BYTES = 1_000_000;
const NO_CHANGE: WebhookOutcome["result"][] = ["ignored", "unchanged", "known", "skipped", "gone"];

// constant time, whatever the lengths (both sides hashed to 32 bytes first)
export function secretMatches(given: unknown, expected: string): boolean {
  if (typeof given !== "string" || !expected) return false;
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b) && given.length === expected.length;
}

// intervals.icu app webhooks (settings → manage app). the shared secret is in
// the json body. answer at once (intervals re-sends anything that isn't a 2xx)
// and do the work after the response: ids from the payload are re-read from
// the api, nothing else in it is trusted.
export async function POST(request: Request) {
  const expected = process.env.INTERVALS_ICU_WEBHOOK_SECRET;
  if (!expected || !isIntervalsConfigured()) {
    return NextResponse.json({ ok: false, error: "not configured" }, { status: 503 });
  }

  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) {
    return NextResponse.json({ ok: false, error: "too large" }, { status: 413 });
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  if (!secretMatches((body as { secret?: unknown } | null)?.secret, expected)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const events = parseWebhookEvents(body, process.env.INTERVALS_ICU_ATHLETE_ID ?? null);
  if (events.length > 0) {
    after(() =>
      withSyncRun({ trigger: "webhook", source: "intervals" }, async () => {
        const outcomes: WebhookOutcome[] = [];
        for (const event of events) {
          try {
            const outcome = await handleWebhookEvent(event);
            outcomes.push(outcome);
            // imports and field changes log themselves; the no-ops are logged here
            if (NO_CHANGE.includes(outcome.result)) {
              await syncEvent({ source: "intervals", kind: "skip", externalId: event.activityId, detail: { reason: `webhook ${event.type}: ${outcome.result}` } });
            }
          } catch (error) {
            // the scheduled pull picks up anything that failed here
            log.error("intervals:webhook", `${event.type} ${event.activityId} failed`, error);
            await syncEvent({ source: "intervals", kind: "error", externalId: event.activityId, detail: { webhook: event.type, message: (error as Error).message } });
          }
        }
        const changed = outcomes.filter((o) => !NO_CHANGE.includes(o.result));
        if (changed.length > 0) {
          revalidatePath("/training");
          revalidatePath("/activities/[id]", "page");
          log.info("intervals:webhook", changed.map((o) => `${o.type} ${o.id}: ${o.result}`).join(", "));
        }
        return { events: events.length, changed: changed.length };
      })
    );
  }
  return NextResponse.json({ ok: true, events: events.length });
}
