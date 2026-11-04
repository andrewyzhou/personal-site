import { NextResponse } from "next/server";
import { bearerMatches } from "@/lib/lift/auth";
import { BodyTooLarge, readCapped } from "@/lib/lift/sync/http";
import { pushMutations } from "@/lib/lift/sync/push";
import { validateEnvelope } from "@/lib/lift/sync/validate";
import { log } from "@/lib/log";
import { revalidateLiftPublic } from "@/lib/lift/revalidate";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// route modules may only export next's known names, so this stays private
const MAX_BODY_BYTES = 2 * 1024 * 1024;

const fail = (status: number, error: string) => NextResponse.json({ ok: false, error }, { status });

export async function POST(request: Request) {
  if (!bearerMatches(request.headers.get("authorization"), process.env.LIFT_APP_TOKEN)) {
    return fail(401, "unauthorized");
  }

  let raw: string;
  try {
    raw = await readCapped(request, MAX_BODY_BYTES);
  } catch (error) {
    if (error instanceof BodyTooLarge) return fail(413, "body too large (max 2mb)");
    return fail(400, "could not read body");
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return fail(400, "body must be json");
  }
  const envelope = validateEnvelope(body);
  if (!envelope.ok) return fail(400, envelope.error);

  try {
    const result = await pushMutations(envelope.deviceId, envelope.mutations);
    // phone workouts and edits show on the lift-only calendar
    revalidateLiftPublic();
    return NextResponse.json(result);
  } catch (error) {
    // nothing was applied; the phone retries the same seqs
    log.error("api:lift/sync", `push from ${envelope.deviceId} failed`, error);
    return fail(500, "sync failed");
  }
}
