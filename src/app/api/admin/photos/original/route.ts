import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { getRawStore, isRawStoreConfigured, isSha256, rawBucket, rawKey } from "@/lib/raw-store";
import { r2PresignPutIn } from "@/lib/r2";
import { MAX_ORIGINAL_BYTES } from "../photo-input";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// step 1 of keeping a photo's untouched original: a presigned put straight
// into the private raw bucket (originals are routinely over vercel's 4.5mb body
// cap). the url is scoped to rawKey(sha): the checksum, the declared size and
// If-None-Match are signed in, so r2 only accepts exactly these bytes, once.
// step 2 is finalize.

interface StartBody {
  sha256?: unknown;
  size?: unknown;
  contentType?: unknown;
  filename?: unknown;
}

const CONTENT_TYPE_RE = /^(image\/[a-z0-9.+-]+|application\/octet-stream)$/i;

export async function POST(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  if (!isRawStoreConfigured()) {
    return NextResponse.json(
      { ok: false, code: "raw-store-unconfigured", error: "private storage isn't configured; originals are not kept" },
      { status: 503 }
    );
  }

  let body: StartBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }

  const { sha256, size, contentType, filename } = body;
  if (typeof sha256 !== "string" || !isSha256(sha256)) {
    return NextResponse.json({ ok: false, error: "sha256 must be 64 lowercase hex chars" }, { status: 400 });
  }
  if (typeof size !== "number" || !Number.isInteger(size) || size <= 0) {
    return NextResponse.json({ ok: false, error: "size must be a positive integer" }, { status: 400 });
  }
  if (size > MAX_ORIGINAL_BYTES) {
    return NextResponse.json({ ok: false, error: `original is over ${MAX_ORIGINAL_BYTES / 1_000_000} mb` }, { status: 413 });
  }
  if (typeof contentType !== "string" || !CONTENT_TYPE_RE.test(contentType)) {
    return NextResponse.json({ ok: false, error: "contentType must be an image type" }, { status: 415 });
  }
  if (filename !== undefined && (typeof filename !== "string" || filename.length > 255)) {
    return NextResponse.json({ ok: false, error: "bad filename" }, { status: 400 });
  }

  try {
    const head = await getRawStore().head(sha256);
    if (head.exists) return NextResponse.json({ ok: true, exists: true });

    const { url, headers } = await r2PresignPutIn(rawBucket(), rawKey(sha256), {
      expiresSeconds: 900,
      // signed: r2 refuses a body of any other size
      contentLength: size,
      headers: {
        "if-none-match": "*",
        "x-amz-checksum-sha256": Buffer.from(sha256, "hex").toString("base64"),
      },
    });
    log.info("admin:photos", `presigned original ${sha256.slice(0, 12)} (${size}b)`);
    return NextResponse.json({ ok: true, exists: false, url, headers });
  } catch (error) {
    log.error("admin:photos", "original presign failed", error);
    return NextResponse.json({ ok: false, error: "could not start the original upload" }, { status: 500 });
  }
}
