import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { requireAdmin } from "@/lib/admin-auth";
import { r2Put } from "@/lib/r2";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// activity photo upload. photos are downscaled client-side (~2000px jpeg,
// 300-500kb) so a simple multipart relay stays far below vercel's 4.5mb cap.
const MAX_PHOTO_BYTES = 3_500_000;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/webp"]);

export async function POST(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, error: "no file in request" }, { status: 400 });
    }
    if (!ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json({ ok: false, error: "only jpeg/webp accepted (photos are converted client-side)" }, { status: 415 });
    }
    if (file.size > MAX_PHOTO_BYTES) {
      return NextResponse.json({ ok: false, error: "photo too large — downscaling failed?" }, { status: 413 });
    }

    const width = Number(form.get("width")) || null;
    const height = Number(form.get("height")) || null;
    const ext = file.type === "image/webp" ? "webp" : "jpg";
    const pathname = `activities/photos/${new Date().getUTCFullYear()}/${randomUUID()}.${ext}`;

    const { url } = await r2Put(pathname, new Uint8Array(await file.arrayBuffer()), file.type);
    log.info("admin:photos", `uploaded ${pathname} (${file.size}b)`);
    return NextResponse.json({ ok: true, url, pathname, width, height });
  } catch (error) {
    log.error("admin:photos", "photo upload failed", error);
    return NextResponse.json({ ok: false, error: "upload failed" }, { status: 500 });
  }
}
