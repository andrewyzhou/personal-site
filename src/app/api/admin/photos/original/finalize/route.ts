import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import {
  getRawStore,
  isRawStoreConfigured,
  isSha256,
  RawIntegrityError,
  RawNotFoundError,
  RawTooLargeError,
} from "@/lib/raw-store";
import { FORMAT_CONTENT_TYPES, sniffImageFormat } from "@/lib/image-strip";
import { MAX_ORIGINAL_BYTES } from "../../photo-input";
import { readPhotoExif } from "../../exif";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

// step 2: the browser put the original into the raw bucket. read it back,
// verify it hashes to its key and is an image within limits, record the
// manifest row (write-once, insert-only), and return the private exif.

class NotAnImageError extends Error {}

export async function POST(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  if (!isRawStoreConfigured()) {
    return NextResponse.json(
      { ok: false, code: "raw-store-unconfigured", error: "private storage isn't configured; originals are not kept" },
      { status: 503 }
    );
  }

  let body: { sha256?: unknown; filename?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }
  const { sha256, filename } = body;
  if (typeof sha256 !== "string" || !isSha256(sha256)) {
    return NextResponse.json({ ok: false, error: "sha256 must be 64 lowercase hex chars" }, { status: 400 });
  }
  if (filename !== undefined && (typeof filename !== "string" || filename.length > 255)) {
    return NextResponse.json({ ok: false, error: "bad filename" }, { status: 400 });
  }

  try {
    const adopted = await getRawStore().adopt(sha256, {
      kind: "photo-original",
      contentType: (bytes) => {
        const format = sniffImageFormat(bytes);
        if (!format) throw new NotAnImageError();
        return FORMAT_CONTENT_TYPES[format];
      },
      filename: (filename as string | undefined) ?? null,
      metadata: { via: "admin-photo-upload" },
      maxBytes: MAX_ORIGINAL_BYTES,
    });
    const meta = await readPhotoExif(adopted.bytes);
    log.info(
      "admin:photos",
      `kept original ${sha256.slice(0, 12)} (${adopted.sizeBytes}b, ${meta.gps ? "gps" : "no gps"}, ${meta.takenAt || meta.takenAtLocal ? "time" : "no time"})`
    );
    return NextResponse.json({
      ok: true,
      originalSha256: sha256,
      takenAt: meta.takenAt,
      takenAtLocal: meta.takenAtLocal,
      gps: meta.gps,
    });
  } catch (error) {
    if (error instanceof RawNotFoundError) {
      return NextResponse.json({ ok: false, code: "not-uploaded", error: "original not found in storage" }, { status: 404 });
    }
    if (error instanceof RawTooLargeError) {
      return NextResponse.json({ ok: false, code: "too-large", error: "original is too large" }, { status: 413 });
    }
    if (error instanceof RawIntegrityError) {
      log.error("admin:photos", `original ${sha256} failed verification`, error);
      return NextResponse.json({ ok: false, code: "sha-mismatch", error: "stored bytes don't match the sha256" }, { status: 422 });
    }
    if (error instanceof NotAnImageError) {
      return NextResponse.json({ ok: false, code: "not-an-image", error: "original is not a recognized image" }, { status: 415 });
    }
    log.error("admin:photos", `original finalize failed for ${sha256}`, error);
    return NextResponse.json({ ok: false, error: "could not finalize the original" }, { status: 500 });
  }
}
