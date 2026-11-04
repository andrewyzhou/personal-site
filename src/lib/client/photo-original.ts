"use client";

// activity photo upload, shared by the upload and edit flows. two paths run in
// parallel for every photo:
//   public:  heic decode + downscale → /api/admin/photos (server strips metadata)
//   private: the untouched original → presigned put into the raw bucket, then
//            finalize (server re-hashes, records it, reads exif)
// the private exif (precise gps + time) only ever goes to admin endpoints; it
// becomes a public pin solely through republish. when the raw store isn't
// configured the original isn't kept and exif is read here instead.

import { prepareImage } from "./image";
import { readPhotoExif, resolveTakenAt, type PhotoExifMeta } from "@/app/api/admin/photos/exif";

export async function sha256OfBlob(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export type OriginalStatus = "stored" | "unconfigured" | "failed";

export interface PhotoPrivateFields {
  originalSha256: string | null;
  takenAt: string | null;
  gpsLat: number | null;
  gpsLng: number | null;
}

export interface UploadedPhoto extends PhotoPrivateFields {
  url: string;
  pathname: string;
  width: number;
  height: number;
  originalStatus: OriginalStatus;
}

async function postJson(url: string, body: unknown): Promise<{ res: Response; json: Record<string, unknown> | null }> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  return { res, json };
}

// keeps the untouched original privately; never throws
async function keepOriginal(file: File): Promise<{ status: OriginalStatus; sha256: string | null; meta: PhotoExifMeta }> {
  const local = () => readPhotoExif(file);
  try {
    const sha256 = await sha256OfBlob(file);
    const start = await postJson("/api/admin/photos/original", {
      sha256,
      size: file.size,
      contentType: file.type || "application/octet-stream",
      filename: file.name,
    });
    if (start.res.status === 503 && start.json?.code === "raw-store-unconfigured") {
      return { status: "unconfigured", sha256: null, meta: await local() };
    }
    if (!start.res.ok || !start.json?.ok) throw new Error(String(start.json?.error ?? start.res.status));

    if (!start.json.exists) {
      const put = await fetch(String(start.json.url), {
        method: "PUT",
        headers: { ...(start.json.headers as Record<string, string>), "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      // 412: someone stored the same bytes first (write-once), which is fine
      if (!put.ok && put.status !== 412) throw new Error(`original put failed (${put.status})`);
    }

    const fin = await postJson("/api/admin/photos/original/finalize", { sha256, filename: file.name });
    if (!fin.res.ok || !fin.json?.ok) throw new Error(String(fin.json?.error ?? fin.res.status));
    const meta: PhotoExifMeta = {
      takenAt: (fin.json.takenAt as string | null) ?? null,
      takenAtLocal: (fin.json.takenAtLocal as string | null) ?? null,
      gps: (fin.json.gps as PhotoExifMeta["gps"]) ?? null,
    };
    return { status: "stored", sha256: String(fin.json.originalSha256), meta };
  } catch (error) {
    console.warn("photo original not kept", error);
    return { status: "failed", sha256: null, meta: await local() };
  }
}

async function uploadPublic(file: File): Promise<{ url: string; pathname: string; width: number; height: number }> {
  const prepared = await prepareImage(file);
  const form = new FormData();
  form.append("file", prepared.blob, "photo.jpg");
  form.append("width", String(prepared.width));
  form.append("height", String(prepared.height));
  const res = await fetch("/api/admin/photos", { method: "POST", body: form });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.ok) throw new Error(body?.error ?? "upload failed");
  return { url: body.url, pathname: body.pathname, width: body.width ?? prepared.width, height: body.height ?? prepared.height };
}

// both paths in parallel; only a failed public upload fails the photo.
// utcOffsetMin resolves an exif time that carries no offset.
export async function uploadActivityPhoto(file: File, opts: { utcOffsetMin?: number | null } = {}): Promise<UploadedPhoto> {
  const [pub, original] = await Promise.all([uploadPublic(file), keepOriginal(file)]);
  return {
    ...pub,
    originalStatus: original.status,
    originalSha256: original.sha256,
    takenAt: resolveTakenAt(original.meta, opts.utcOffsetMin),
    gpsLat: original.meta.gps?.lat ?? null,
    gpsLng: original.meta.gps?.lng ?? null,
  };
}
