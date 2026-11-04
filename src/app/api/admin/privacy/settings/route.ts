import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { requireAdmin } from "@/lib/admin-auth";
import { getDb, privacySettings, type PrivacySettings } from "@/lib/db";
import { loadPrivacySettings, normalizeSettings } from "@/lib/privacy/settings";
import { countPending, markAllStale } from "@/lib/privacy/stale";
import { stableStringify } from "@/lib/republish";
import { bad, failure, readJson } from "../http";

export const dynamic = "force-dynamic";

// GET: the settings in effect + recent history (insert-only, newest wins)
export async function GET(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  try {
    const [settings, history, pending] = await Promise.all([
      loadPrivacySettings(),
      getDb().select().from(privacySettings).orderBy(desc(privacySettings.id)).limit(20),
      countPending(),
    ]);
    return NextResponse.json({ ok: true, settings, history, pending });
  } catch (error) {
    return failure("admin:privacy:settings", error);
  }
}

// posted fields merge onto the current settings; any provided value that
// normalization would change is rejected instead of silently replaced
function merge(current: PrivacySettings, body: Record<string, unknown>): PrivacySettings | string {
  if (body.distance !== undefined && (typeof body.distance !== "object" || body.distance === null || Array.isArray(body.distance))) {
    return "distance must be an object";
  }
  const d = (body.distance ?? {}) as Record<string, unknown>;
  const merged = {
    distance: { ...current.distance, ...d },
    coarsenStartMin: body.coarsenStartMin ?? current.coarsenStartMin,
    defaultTrimM: body.defaultTrimM ?? current.defaultTrimM,
  };
  const out = normalizeSettings(merged);
  if (d.mode !== undefined && d.mode !== out.distance.mode) return "unknown distance mode";
  if (d.roundToM !== undefined && d.roundToM !== out.distance.roundToM) return "roundToM must be 10–5000";
  if (body.coarsenStartMin !== undefined && body.coarsenStartMin !== out.coarsenStartMin) return "unsupported coarsenStartMin";
  if (body.defaultTrimM !== undefined && body.defaultTrimM !== out.defaultTrimM) return "defaultTrimM must be 0–5000";
  return out;
}

// POST: insert a new settings row, then every activity is stale
export async function POST(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  const body = await readJson(request);
  if (!body) return bad("invalid json body");
  try {
    const current = await loadPrivacySettings();
    const next = merge(current, body);
    if (typeof next === "string") return bad(next);
    if (stableStringify(next) === stableStringify(current)) {
      return NextResponse.json({ ok: true, settings: current, unchanged: true, marked: 0, pending: await countPending() });
    }
    // marked before the insert too: a failure after it never leaves new
    // settings live with nothing flagged
    await markAllStale();
    await getDb().insert(privacySettings).values({ settings: next });
    const marked = await markAllStale();
    return NextResponse.json({ ok: true, settings: next, marked, pending: await countPending() });
  } catch (error) {
    return failure("admin:privacy:settings", error);
  }
}
