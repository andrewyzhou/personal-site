import { describe, it, expect, vi, beforeEach } from "vitest";

const { r2Put } = vi.hoisted(() => ({ r2Put: vi.fn() }));

vi.mock("@/lib/admin-auth", () => ({ requireAdmin: async () => null }));
vi.mock("@/lib/r2", () => ({ r2Put: (...a: unknown[]) => r2Put(...a) }));

import { POST as photoUpload } from "@/app/api/admin/photos/route";
import { POST as cmsUpload } from "@/app/api/admin/upload/route";
import { hasLocationMetadata } from "@/lib/image-strip";
import { buildJpeg, buildPng, buildTiff, buildWebp, JPEG_PARTS, strippedJpeg } from "@/lib/__tests__/fixtures/images";

const TIFF = buildTiff({ lat: 37.8716, lng: -122.2727, dateTimeOriginal: "2026:10:03 08:02:52" });

function form(bytes: Uint8Array, type: string, extra: Record<string, string> = {}) {
  const f = new FormData();
  f.append("file", new File([bytes as BlobPart], "photo", { type }));
  for (const [k, v] of Object.entries(extra)) f.append(k, v);
  return new Request("http://localhost/api/admin/x", { method: "POST", body: f });
}

const putBytes = () => r2Put.mock.calls[0][1] as Uint8Array;

beforeEach(() => {
  vi.clearAllMocks();
  r2Put.mockImplementation(async (pathname: string) => ({ url: `https://cdn.test/${pathname}`, pathname }));
});

describe("public image uploads strip metadata before storage", () => {
  it("activity photos: jpeg exif/gps never reaches the public bucket", async () => {
    const res = await photoUpload(form(buildJpeg(TIFF), "image/jpeg", { width: "2000", height: "1500" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, width: 2000, height: 1500 });
    expect(Array.from(putBytes())).toEqual(Array.from(strippedJpeg()));
    expect(hasLocationMetadata(putBytes())).toBe(false);
  });

  it("activity photos: webp too", async () => {
    expect((await photoUpload(form(buildWebp(TIFF), "image/webp"))).status).toBe(200);
    expect(hasLocationMetadata(putBytes())).toBe(false);
  });

  it("rejects contents that don't match the declared type, and malformed images", async () => {
    expect((await photoUpload(form(buildPng(TIFF), "image/jpeg"))).status).toBe(415);
    const truncated = new Uint8Array([...JPEG_PARTS.soi, ...JPEG_PARTS.app0, ...JPEG_PARTS.dqt]);
    expect((await photoUpload(form(truncated, "image/jpeg"))).status).toBe(415);
    expect(r2Put).not.toHaveBeenCalled();
  });

  it("cms uploads: png text/exif chunks are dropped", async () => {
    const res = await cmsUpload(form(buildPng(TIFF), "image/png", { prefix: "content/blog/my-post" }));
    expect(res.status).toBe(200);
    expect(hasLocationMetadata(putBytes())).toBe(false);
    expect(Buffer.from(putBytes()).toString("latin1")).not.toContain("tEXt");
  });

  it("cms uploads: jpeg stripped, mislabeled refused", async () => {
    expect((await cmsUpload(form(buildJpeg(TIFF), "image/jpeg", { prefix: "content/blog/x" }))).status).toBe(200);
    expect(Array.from(putBytes())).toEqual(Array.from(strippedJpeg()));
    r2Put.mockClear();
    expect((await cmsUpload(form(buildJpeg(TIFF), "image/png", { prefix: "content/blog/x" }))).status).toBe(415);
    expect(r2Put).not.toHaveBeenCalled();
  });
});
