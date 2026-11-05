import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { archiveZone, purgeZone, normalizeName, normalizePolygon, updateZone, type ZonePatch } from "@/lib/privacy/zones";
import { countPending, markStaleForZones } from "@/lib/privacy/stale";
import { bad, failure, parseId, readJson } from "../../http";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// PATCH { name?, enabled?, polygon? }: a shape change makes a new version and
// archives this one; name/enabled change in place
export async function PATCH(request: Request, { params }: Ctx) {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  const id = parseId((await params).id);
  if (!id) return bad("bad id");
  const body = await readJson(request);
  if (!body) return bad("invalid json body");

  const patch: ZonePatch = {};
  if (body.name !== undefined) {
    const name = normalizeName(body.name);
    if (name === null) return bad("name must be a string");
    patch.name = name;
  }
  if (body.enabled !== undefined) {
    if (typeof body.enabled !== "boolean") return bad("enabled must be a boolean");
    patch.enabled = body.enabled;
  }
  if (body.polygon !== undefined) {
    const poly = normalizePolygon(body.polygon);
    if ("error" in poly) return bad(poly.error);
    patch.polygon = poly.polygon;
  }
  if (Object.keys(patch).length === 0) return bad("nothing to change");

  try {
    const { zone, touched } = await updateZone(id, patch, { markStale: markStaleForZones });
    // marked before the write (inside the zone lib) and again after it
    const marked = await markStaleForZones(touched);
    return NextResponse.json({ ok: true, zone, marked, pending: await countPending() });
  } catch (error) {
    return failure("admin:privacy:zones", error);
  }
}

// DELETE: archive (restorable from history). DELETE ?purge=1 on an archived
// zone removes it and its whole version history for good
export async function DELETE(request: Request, { params }: Ctx) {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  const id = parseId((await params).id);
  if (!id) return bad("bad id");
  if (new URL(request.url).searchParams.get("purge") === "1") {
    try {
      const { deletedIds } = await purgeZone(id);
      return NextResponse.json({ ok: true, deletedIds, pending: await countPending() });
    } catch (error) {
      return failure("admin:privacy:zones", error);
    }
  }
  try {
    const { zone, touched } = await archiveZone(id, { markStale: markStaleForZones });
    // marked before the write (inside the zone lib) and again after it
    const marked = await markStaleForZones(touched);
    return NextResponse.json({ ok: true, zone, marked, pending: await countPending() });
  } catch (error) {
    return failure("admin:privacy:zones", error);
  }
}
