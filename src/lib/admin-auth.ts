import { NextResponse } from "next/server";
import { getSessionUser } from "./auth";
import { isLocalPreview } from "./local-preview";

// admin gate for mutation endpoints: a signed-in allowlisted google session
// (the admin ui path) or the shared-secret header (scripts / curl fallback).
// fails closed on both paths.
export async function isAdminRequest(request: Request): Promise<boolean> {
  try {
    const user = await getSessionUser();
    if (user?.isAdmin) {
      // cheap csrf hardening on top of lax cookies: browser-sent mutations must
      // originate from our own site (requests without an origin header — curl,
      // server-side — are fine, they can't ride a victim's cookies)
      const origin = request.headers.get("origin");
      if (origin && !isAllowedOrigin(origin, request)) {
        return false;
      }
      return true;
    }
  } catch {
    // auth not configured / session store unavailable — fall through to secret
  }

  const secret = process.env.ADMIN_API_SECRET;
  if (!secret) return false;
  return request.headers.get("x-admin-secret") === secret;
}

const CANONICAL_ORIGINS = ["https://www.andrewzhou.org", "https://andrewzhou.org"];

// same-origin check that doesn't depend on NEXT_PUBLIC_SITE_URL alone (that one
// feeds oauth redirect uris and may point at a loopback address)
function isAllowedOrigin(origin: string, request: Request): boolean {
  const allowed = new Set<string>([...CANONICAL_ORIGINS, "http://localhost:3000", "http://127.0.0.1:3000"]);
  const site = (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "");
  if (site) allowed.add(site);
  try {
    allowed.add(new URL(request.url).origin);
  } catch {
    // unparsable request url: rely on the fixed list
  }
  return allowed.has(origin);
}

export function unauthorizedResponse(): NextResponse {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

// helper for admin routes: returns a 401 response to short-circuit with, or null
export async function requireAdmin(request: Request): Promise<NextResponse | null> {
  // local design preview: reads only, never writes (see lib/local-preview)
  if (isLocalPreview() && (request.method === "GET" || request.method === "HEAD")) return null;
  return (await isAdminRequest(request)) ? null : unauthorizedResponse();
}
