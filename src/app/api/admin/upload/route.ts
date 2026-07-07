import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { requireAdmin } from "@/lib/admin-auth";
import { r2Put } from "@/lib/r2";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

// generic cms image upload (editor inline images, covers, photo essays).
// images are downscaled client-side, so a multipart relay stays well under the
// 4.5mb request cap. pathname prefix is allowlisted to content namespaces.
const MAX_BYTES = 3_500_000;
const ALLOWED_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/png": "png",
};
const PREFIX_RE = /^content\/[a-z-]+\/[a-z0-9-_]+$/;

export async function POST(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  try {
    const form = await request.formData();
    const file = form.get("file");
    const prefix = String(form.get("prefix") ?? "");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: { code: "validation", message: "no file in request" } }, { status: 400 });
    }
    if (!PREFIX_RE.test(prefix)) {
      return NextResponse.json({ error: { code: "validation", message: "bad upload prefix" } }, { status: 400 });
    }
    if (!(file.type in ALLOWED_TYPES)) {
      return NextResponse.json({ error: { code: "validation", message: "only jpeg/webp/png accepted" } }, { status: 415 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: { code: "validation", message: "image too large — downscaling failed?" } }, { status: 413 });
    }

    const width = Number(form.get("width")) || null;
    const height = Number(form.get("height")) || null;
    const pathname = `${prefix}/${randomUUID()}.${ALLOWED_TYPES[file.type]}`;
    const { url } = await r2Put(pathname, new Uint8Array(await file.arrayBuffer()), file.type);
    log.info("admin:upload", `uploaded ${pathname} (${file.size}b)`);
    return NextResponse.json({ data: { url, pathname, width, height } });
  } catch (error) {
    log.error("admin:upload", "upload failed", error);
    return NextResponse.json({ error: { code: "internal", message: "upload failed" } }, { status: 500 });
  }
}
