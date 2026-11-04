// GET  /api/admin/activity-settings
//   200 { ok: true, settings: { autoApply: { enabled, minConfidence }, hrMaxBpm, hrZonePcts },
//         history: [{ id, settings, createdAt }] (newest first, ≤ 20) }
// POST /api/admin/activity-settings { autoApply?: { enabled?, minConfidence? }, hrMaxBpm?, hrZonePcts? }
//   posted fields merge onto the current settings and a new normalized row is
//   inserted (insert-only, newest wins). a value normalization would change is
//   rejected. hr zone changes mark every activity stale (hr_zones_s changes).
//   200 { ok: true, settings, unchanged: boolean, marked: number }
//   400 bad body / value · 401 · 500
import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { requireAdmin } from "@/lib/admin-auth";
import { getDb, activitySettings, type ActivitySettings } from "@/lib/db";
import { loadActivitySettings, normalizeActivitySettings } from "@/lib/cleaning/settings";
import { markAllStale } from "@/lib/privacy/stale";
import { stableStringify } from "@/lib/republish";
import { bad, failure, readJson } from "../privacy/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  try {
    const [settings, history] = await Promise.all([
      loadActivitySettings(),
      getDb().select().from(activitySettings).orderBy(desc(activitySettings.id)).limit(20),
    ]);
    return NextResponse.json({ ok: true, settings, history });
  } catch (error) {
    return failure("admin:activity-settings", error);
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function merge(current: ActivitySettings, body: Record<string, unknown>): ActivitySettings | string {
  if (body.autoApply !== undefined && !isObj(body.autoApply)) return "autoApply must be an object";
  const a = (body.autoApply ?? {}) as Record<string, unknown>;
  const out = normalizeActivitySettings({
    autoApply: { ...current.autoApply, ...a },
    hrMaxBpm: body.hrMaxBpm ?? current.hrMaxBpm,
    hrZonePcts: body.hrZonePcts ?? current.hrZonePcts,
  });
  if (a.enabled !== undefined && a.enabled !== out.autoApply.enabled) return "autoApply.enabled must be a boolean";
  if (a.minConfidence !== undefined && a.minConfidence !== out.autoApply.minConfidence) return "autoApply.minConfidence must be 0.5–1";
  if (body.hrMaxBpm !== undefined && body.hrMaxBpm !== out.hrMaxBpm) return "hrMaxBpm must be 120–230";
  if (body.hrZonePcts !== undefined && stableStringify(body.hrZonePcts) !== stableStringify(out.hrZonePcts)) {
    return "hrZonePcts must be 4 increasing fractions between 0.3 and 1";
  }
  return out;
}

export async function POST(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  const body = await readJson(request);
  if (!body) return bad("invalid json body");
  try {
    const current = await loadActivitySettings();
    const next = merge(current, body);
    if (typeof next === "string") return bad(next);
    if (stableStringify(next) === stableStringify(current)) {
      return NextResponse.json({ ok: true, settings: current, unchanged: true, marked: 0 });
    }
    const zonesChanged = next.hrMaxBpm !== current.hrMaxBpm || stableStringify(next.hrZonePcts) !== stableStringify(current.hrZonePcts);
    // marked before the insert too: a failure after it never leaves new zones
    // live with nothing flagged
    if (zonesChanged) await markAllStale();
    await getDb().insert(activitySettings).values({ settings: next });
    const marked = zonesChanged ? await markAllStale() : 0;
    return NextResponse.json({ ok: true, settings: next, unchanged: false, marked });
  } catch (error) {
    return failure("admin:activity-settings", error);
  }
}
