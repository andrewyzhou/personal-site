import { NextResponse } from "next/server";
import { getSessionUser } from "./auth";

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
      if (origin && !isAllowedOrigin(origin)) {
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

function isAllowedOrigin(origin: string): boolean {
  const site = (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "");
  const allowed = new Set(
    [site, site.replace("://www.", "://"), "http://localhost:3000"].filter(Boolean)
  );
  return allowed.has(origin);
}

export function unauthorizedResponse(): NextResponse {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

// helper for admin routes: returns a 401 response to short-circuit with, or null
export async function requireAdmin(request: Request): Promise<NextResponse | null> {
  return (await isAdminRequest(request)) ? null : unauthorizedResponse();
}
