import { NextResponse, after } from "next/server";
import { applyStravaUpdate, hideStravaActivity, syncStravaActivities } from "@/lib/strava-sync";
import { isStravaApiEnabled } from "@/lib/strava";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// subscription handshake: strava echoes back hub.challenge once at subscribe time
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const verifyToken = process.env.STRAVA_WEBHOOK_VERIFY_TOKEN;
  if (
    params.get("hub.mode") !== "subscribe" ||
    !verifyToken ||
    params.get("hub.verify_token") !== verifyToken
  ) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  return NextResponse.json({ "hub.challenge": params.get("hub.challenge") });
}

interface StravaEvent {
  object_type: "activity" | "athlete";
  object_id: number;
  aspect_type: "create" | "update" | "delete";
}

// events are unauthenticated, so they only ever trigger re-reads from strava:
// nothing in the body is trusted beyond the activity id. strava wants a 200
// within 2s, so the work runs after the response.
export async function POST(request: Request) {
  let event: StravaEvent;
  try {
    event = await request.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  if (!isStravaApiEnabled() || event.object_type !== "activity" || !Number.isSafeInteger(event.object_id)) {
    return NextResponse.json({ ok: true });
  }

  after(async () => {
    try {
      if (event.aspect_type === "create") {
        const result = await syncStravaActivities();
        log.info("api:strava/webhook", `create ${event.object_id}: ${JSON.stringify(result)}`);
      } else if (event.aspect_type === "update") {
        // an update can arrive for an activity the sync hasn't seen yet
        if (!(await applyStravaUpdate(event.object_id))) await syncStravaActivities();
      } else if (event.aspect_type === "delete") {
        await hideStravaActivity(event.object_id);
      }
    } catch (error) {
      log.error("api:strava/webhook", `${event.aspect_type} ${event.object_id} failed`, error);
    }
  });
  return NextResponse.json({ ok: true });
}
