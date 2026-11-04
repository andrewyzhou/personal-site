// shared bits for the privacy admin routes
import { NextResponse } from "next/server";
import { ZoneError } from "@/lib/privacy/zones";
import { log } from "@/lib/log";

export const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });

export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json();
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function failure(source: string, error: unknown) {
  if (error instanceof ZoneError) return bad(error.message, error.status);
  log.error(source, "request failed", error);
  return bad("internal error", 500);
}
