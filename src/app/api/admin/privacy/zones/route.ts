import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { createZone, listZones, normalizeName, normalizePolygon } from "@/lib/privacy/zones";
import { countPending, markStaleForZones } from "@/lib/privacy/stale";
import { bad, failure, readJson } from "../http";

export const dynamic = "force-dynamic";

// GET: every zone with its version history (admin only; zones never reach the public)
export async function GET(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  try {
    const [zones, pending] = await Promise.all([listZones(), countPending()]);
    return NextResponse.json({ ok: true, zones, pending });
  } catch (error) {
    return failure("admin:privacy:zones", error);
  }
}

// POST { name, polygon }: new zone; activities near it become stale
export async function POST(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  const body = await readJson(request);
  if (!body) return bad("invalid json body");
  const name = body.name === undefined ? "" : normalizeName(body.name);
  if (name === null) return bad("name must be a string");
  const poly = normalizePolygon(body.polygon);
  if ("error" in poly) return bad(poly.error);
  try {
    const { zone, touched } = await createZone(name, poly.polygon);
    const marked = await markStaleForZones(touched);
    return NextResponse.json({ ok: true, zone, marked, pending: await countPending() });
  } catch (error) {
    return failure("admin:privacy:zones", error);
  }
}
