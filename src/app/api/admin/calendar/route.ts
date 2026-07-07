import { requireAdmin } from "@/lib/admin-auth";
import { ok, fail } from "@/lib/admin/api-envelope";
import { getCalendarEvents } from "@/lib/admin/calendar-events";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const YM_RE = /^\d{4}-\d{2}$/;

export async function GET(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const params = new URL(request.url).searchParams;
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  if (!YM_RE.test(from) || !YM_RE.test(to) || from > to) {
    return fail("validation", "from/to must be yyyy-mm with from ≤ to", 400);
  }
  // clamp to 12 months
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  if ((ty - fy) * 12 + (tm - fm) > 11) {
    return fail("validation", "range too large — max 12 months", 400);
  }

  try {
    const payload = await getCalendarEvents(from, to);
    return ok(payload);
  } catch (error) {
    log.error("admin:calendar", "merge failed", error);
    return fail("internal", "calendar unavailable", 500);
  }
}
