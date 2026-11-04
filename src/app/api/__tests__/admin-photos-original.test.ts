import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

const { state, presign } = vi.hoisted(() => ({
  state: {
    denied: false,
    configured: true,
    store: null as unknown,
  },
  presign: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({
  requireAdmin: async () => (state.denied ? NextResponse.json({ error: "unauthorized" }, { status: 401 }) : null),
}));
vi.mock("@/lib/r2", () => ({ r2PresignPutIn: (...a: unknown[]) => presign(...a) }));
vi.mock("@/lib/raw-store", async (orig) => ({
  ...(await orig<typeof import("@/lib/raw-store")>()),
  isRawStoreConfigured: () => state.configured,
  getRawStore: () => state.store,
  rawBucket: () => "raw-bucket",
}));

import { POST as start } from "@/app/api/admin/photos/original/route";
import { POST as finalize } from "@/app/api/admin/photos/original/finalize/route";
import { createRawStore, rawKey, sha256Hex, type RawBackend, type RawManifest } from "@/lib/raw-store";
import type { RawObjectRow } from "@/lib/db/schema";
import { buildJpeg, buildTiff } from "@/lib/__tests__/fixtures/images";

let objects: Map<string, Uint8Array>;
let rows: Map<string, RawObjectRow>;

beforeEach(() => {
  vi.clearAllMocks();
  state.denied = false;
  state.configured = true;
  objects = new Map();
  rows = new Map();
  const backend: RawBackend = {
    head: async (k) => (objects.has(k) ? { size: objects.get(k)!.length } : null),
    putIfAbsent: async () => "created",
    get: async (k) => objects.get(k)?.slice() ?? null,
    put: async () => undefined,
  };
  const manifest: RawManifest = {
    record: async (r) => void (rows.has(r.sha256) || rows.set(r.sha256, { ...r, createdAt: new Date(0) })),
    find: async (sha) => rows.get(sha) ?? null,
  };
  state.store = createRawStore(backend, manifest);
  presign.mockResolvedValue({ url: "https://signed.example/put", headers: { "if-none-match": "*", "x-amz-checksum-sha256": "c2hh" } });
});

const post = (handler: (r: Request) => Promise<Response>, body: unknown) =>
  handler(new Request("http://localhost/api/admin/photos/original", { method: "POST", body: JSON.stringify(body) }));

const JPEG = buildJpeg(buildTiff({ lat: 37.8716, lng: -122.2727, dateTimeOriginal: "2026:10:03 08:02:52", offsetTimeOriginal: "-07:00" }));
const SHA = sha256Hex(JPEG);

describe("POST /api/admin/photos/original", () => {
  it("presigns a write-once, checksum-bound put for rawKey(sha) in the raw bucket", async () => {
    const res = await post(start, { sha256: SHA, size: JPEG.length, contentType: "image/heic", filename: "IMG_1.HEIC" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      exists: false,
      url: "https://signed.example/put",
      headers: { "if-none-match": "*", "x-amz-checksum-sha256": "c2hh" },
    });
    const [bucket, key, opts] = presign.mock.calls[0];
    expect(bucket).toBe("raw-bucket");
    expect(key).toBe(rawKey(SHA));
    expect(opts.headers).toEqual({ "if-none-match": "*", "x-amz-checksum-sha256": Buffer.from(SHA, "hex").toString("base64") });
  });

  it("shortcuts when the bytes are already stored", async () => {
    objects.set(rawKey(SHA), JPEG);
    const res = await post(start, { sha256: SHA, size: JPEG.length, contentType: "image/jpeg" });
    expect(await res.json()).toEqual({ ok: true, exists: true });
    expect(presign).not.toHaveBeenCalled();
  });

  it("validates sha, size, type and filename", async () => {
    const ok = { sha256: SHA, size: 10, contentType: "image/jpeg" };
    expect((await post(start, { ...ok, sha256: "ABC" })).status).toBe(400);
    expect((await post(start, { ...ok, sha256: SHA.toUpperCase() })).status).toBe(400);
    expect((await post(start, { ...ok, size: 0 })).status).toBe(400);
    expect((await post(start, { ...ok, size: 1.5 })).status).toBe(400);
    expect((await post(start, { ...ok, size: 60_000_000 })).status).toBe(413);
    expect((await post(start, { ...ok, contentType: "text/html" })).status).toBe(415);
    expect((await post(start, { ...ok, filename: "x".repeat(300) })).status).toBe(400);
    expect((await post(start, { ...ok, contentType: "application/octet-stream" })).status).toBe(200);
    expect(presign).toHaveBeenCalledTimes(1);
  });

  it("returns 503 raw-store-unconfigured when there is no private bucket", async () => {
    state.configured = false;
    const res = await post(start, { sha256: SHA, size: 10, contentType: "image/jpeg" });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, code: "raw-store-unconfigured" });
  });

  it("requires admin", async () => {
    state.denied = true;
    expect((await post(start, { sha256: SHA, size: 10, contentType: "image/jpeg" })).status).toBe(401);
    expect(presign).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/photos/original/finalize", () => {
  it("verifies the stored bytes, records the manifest row and returns the private exif", async () => {
    objects.set(rawKey(SHA), JPEG);
    const res = await post(finalize, { sha256: SHA, filename: "IMG_1.jpg" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, originalSha256: SHA, takenAt: "2026-10-03T15:02:52.000Z", takenAtLocal: null });
    expect(body.gps.lat).toBeCloseTo(37.8716, 4);
    expect(body.gps.lng).toBeCloseTo(-122.2727, 4);
    expect(rows.get(SHA)).toMatchObject({
      kind: "photo-original",
      contentType: "image/jpeg",
      originalFilename: "IMG_1.jpg",
      sizeBytes: JPEG.length,
      key: rawKey(SHA),
    });
  });

  it("rejects bytes that don't match the sha (nothing recorded)", async () => {
    objects.set(rawKey(SHA), new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]));
    const res = await post(finalize, { sha256: SHA });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ ok: false, code: "sha-mismatch" });
    expect(rows.size).toBe(0);
  });

  it("404s when the browser put never landed", async () => {
    const res = await post(finalize, { sha256: SHA });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: "not-uploaded" });
  });

  it("refuses non-images without recording them", async () => {
    const junk = new TextEncoder().encode("<html>not a photo</html>");
    objects.set(rawKey(sha256Hex(junk)), junk);
    const res = await post(finalize, { sha256: sha256Hex(junk) });
    expect(res.status).toBe(415);
    expect(rows.size).toBe(0);
  });

  it("refuses oversized objects", async () => {
    const big = new Uint8Array(50_000_001);
    big.set([0xff, 0xd8, 0xff]);
    const sha = sha256Hex(big);
    objects.set(rawKey(sha), big);
    const res = await post(finalize, { sha256: sha });
    expect(res.status).toBe(413);
    expect(rows.size).toBe(0);
  });

  it("validates input, 503s when unconfigured, requires admin", async () => {
    expect((await post(finalize, { sha256: "nope" })).status).toBe(400);
    state.configured = false;
    expect((await post(finalize, { sha256: SHA })).status).toBe(503);
    state.configured = true;
    state.denied = true;
    expect((await post(finalize, { sha256: SHA })).status).toBe(401);
  });
});
