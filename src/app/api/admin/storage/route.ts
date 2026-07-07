import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { r2Usage } from "@/lib/r2";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";

// r2 free tier is 10 gb-month; overage bills at $0.015/gb-mo (no lockout cliff
// like vercel blob, but the audit stays — storage surprises are never welcome)
const WARN_BYTES = 8_000_000_000;
const ERROR_BYTES = 9_500_000_000;

export async function GET(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  try {
    const { totalBytes, count } = await r2Usage();
    if (totalBytes > ERROR_BYTES) {
      log.error("admin:storage", `r2 store at ${totalBytes} bytes — nearing free tier limit`);
    } else if (totalBytes > WARN_BYTES) {
      log.warn("admin:storage", `r2 store at ${totalBytes} bytes`);
    }
    return NextResponse.json({ ok: true, totalBytes, count, warning: totalBytes > WARN_BYTES });
  } catch (error) {
    log.error("admin:storage", "usage audit failed", error);
    return NextResponse.json({ ok: false, error: "audit failed" }, { status: 500 });
  }
}
