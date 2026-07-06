import { NextResponse } from "next/server";

// temporary shared-secret gate for mutation endpoints until real admin auth (ws2)
// lands. callers must send the secret in the `x-admin-secret` header. fails
// closed: if ADMIN_API_SECRET is unset, every request is rejected.
export function isAdminRequest(request: Request): boolean {
  const secret = process.env.ADMIN_API_SECRET;
  if (!secret) return false;
  return request.headers.get("x-admin-secret") === secret;
}

export function unauthorizedResponse(): NextResponse {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}
