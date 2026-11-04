import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin-auth";
import { countPending } from "@/lib/privacy/stale";
import { republishPending } from "@/lib/privacy/rebuild";
import { failure, readJson } from "../http";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET: pending count only
export async function GET(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  try {
    return NextResponse.json({ ok: true, pending: await countPending() });
  } catch (error) {
    return failure("admin:privacy:rebuild", error);
  }
}

// POST { excludeIds? }: one time-boxed batch. the admin ui loops until
// remaining is 0, passing back ids that failed so they don't block the rest.
export async function POST(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  const body = (await readJson(request)) ?? {};
  const excludeIds = Array.isArray(body.excludeIds)
    ? body.excludeIds.filter((n): n is number => Number.isInteger(n) && (n as number) > 0)
    : [];
  try {
    const r = await republishPending({ excludeIds, revalidate: revalidatePath });
    return NextResponse.json({
      ok: true,
      processed: r.results.length,
      results: r.results,
      failedIds: r.failedIds,
      remaining: r.remaining,
      pending: r.remaining,
      timedOut: r.timedOut,
    });
  } catch (error) {
    return failure("admin:privacy:rebuild", error);
  }
}
