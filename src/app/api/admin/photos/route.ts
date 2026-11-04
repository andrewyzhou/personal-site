import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { requireAdmin } from "@/lib/admin-auth";
import { r2Put } from "@/lib/r2";
import { FORMAT_CONTENT_TYPES, ImageStripError, sniffImageFormat, stripImageMetadata } from "@/lib/image-strip";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

// activity photo upload (the public copy). photos are downscaled client-side
// (~2000px jpeg, 300-500kb) so a simple multipart relay stays far below
// vercel's 4.5mb cap. the untouched original goes to the private bucket via
// /api/admin/photos/original. metadata is stripped here regardless of what the
// client did: nothing public ever carries exif/xmp.
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

    const raw = new Uint8Array(await file.arrayBuffer());
    const format = sniffImageFormat(raw);
    if (!format || FORMAT_CONTENT_TYPES[format] !== file.type) {
      return NextResponse.json({ ok: false, error: "file contents don't match its type" }, { status: 415 });
    }
    let bytes: Uint8Array;
    try {
      bytes = stripImageMetadata(raw);
    } catch (error) {
      if (!(error instanceof ImageStripError)) throw error;
      return NextResponse.json({ ok: false, error: `unreadable image: ${error.message}` }, { status: 415 });
    }

    const width = Number(form.get("width")) || null;
    const height = Number(form.get("height")) || null;
    const ext = file.type === "image/webp" ? "webp" : "jpg";
    const pathname = `activities/photos/${new Date().getUTCFullYear()}/${randomUUID()}.${ext}`;

    const { url } = await r2Put(pathname, bytes, file.type);
    log.info("admin:photos", `uploaded ${pathname} (${bytes.length}b, ${raw.length - bytes.length}b metadata stripped)`);
    return NextResponse.json({ ok: true, url, pathname, width, height });
  } catch (error) {
    log.error("admin:photos", "photo upload failed", error);
    return NextResponse.json({ ok: false, error: "upload failed" }, { status: 500 });
  }
}
