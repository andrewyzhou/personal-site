import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { restoreZone } from "@/lib/privacy/zones";
import { countPending, markStaleForZones } from "@/lib/privacy/stale";
import { bad, failure, parseId } from "../../../http";

export const dynamic = "force-dynamic";

// POST: bring an archived version back; any other active version of the same
// zone is archived so only one is in effect
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  const id = parseId((await params).id);
  if (!id) return bad("bad id");
  try {
    const { zone, touched } = await restoreZone(id, { markStale: markStaleForZones });
    // marked before the write (inside the zone lib) and again after it
    const marked = await markStaleForZones(touched);
    return NextResponse.json({ ok: true, zone, marked, pending: await countPending() });
  } catch (error) {
    return failure("admin:privacy:zones", error);
  }
}
