import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createRawStore,
  r2RawBackend,
  rawKey,
  sha256Hex,
  RawIntegrityError,
  type RawBackend,
  type RawManifest,
} from "../raw-store";
import type { RawObjectRow } from "../db/schema";

// in-memory backend with the same write-once contract as the r2 one
function memoryBackend() {
  const objects = new Map<string, Uint8Array>();
  const calls = { putIfAbsent: 0, put: 0 };
  const backend: RawBackend = {
    async head(key) {
      const o = objects.get(key);
      return o ? { size: o.length } : null;
    },
    async putIfAbsent(key, bytes, _ct, sha) {
      calls.putIfAbsent++;
      if (sha256Hex(bytes) !== sha) throw new Error("checksum mismatch");
      if (objects.has(key)) return "exists";
      objects.set(key, bytes.slice());
      return "created";
    },
    async get(key) {
      return objects.get(key)?.slice() ?? null;
    },
    async put(key, bytes) {
      calls.put++;
      objects.set(key, bytes.slice());
    },
  };
  return { backend, objects, calls };
}

function memoryManifest() {
  const rows = new Map<string, RawObjectRow>();
  const manifest: RawManifest = {
    async record(row) {
      if (!rows.has(row.sha256)) rows.set(row.sha256, { ...row, createdAt: new Date(0) });
    },
    async find(sha) {
      return rows.get(sha) ?? null;
    },
  };
  return { manifest, rows };
}

const bytes = (s: string) => new TextEncoder().encode(s);

let mem: ReturnType<typeof memoryBackend>;
let man: ReturnType<typeof memoryManifest>;
let store: ReturnType<typeof createRawStore>;

beforeEach(() => {
  mem = memoryBackend();
  man = memoryManifest();
  store = createRawStore(mem.backend, man.manifest);
});

describe("rawKey", () => {
  it("is content-addressed and fanned out by prefix", () => {
    const sha = sha256Hex(bytes("x"));
    expect(rawKey(sha)).toBe(`sha256/${sha.slice(0, 2)}/${sha}`);
  });

  it("rejects anything that isn't a sha256", () => {
    expect(() => rawKey("../etc/passwd")).toThrow();
    expect(() => rawKey("ABC")).toThrow();
  });
});

describe("raw store put", () => {
  it("stores bytes under their sha and records one manifest row", async () => {
    const b = bytes("hello fit");
    const res = await store.put(b, { kind: "device-file", contentType: "application/octet-stream", filename: "a.fit" });
    expect(res.sha256).toBe(sha256Hex(b));
    expect(res.created).toBe(true);
    expect(res.sizeBytes).toBe(b.length);
    expect(mem.objects.get(res.key)).toEqual(b);
    expect(man.rows.get(res.sha256)).toMatchObject({ kind: "device-file", originalFilename: "a.fit", sizeBytes: b.length });
  });

  it("is idempotent and write-once: a second put never rewrites", async () => {
    const b = bytes("same bytes");
    await store.put(b, { kind: "text", contentType: "text/plain" });
    const again = await store.put(b, { kind: "text", contentType: "text/plain", metadata: { later: true } });
    expect(again.created).toBe(false);
    expect(mem.calls.putIfAbsent).toBe(1);
    expect(man.rows.size).toBe(1);
    // first manifest row wins (insert-only)
    expect(man.rows.get(again.sha256)?.metadata).toBeNull();
  });

  it("aborts before writing when the expected sha doesn't match", async () => {
    await expect(
      store.put(bytes("abc"), { kind: "device-file", contentType: "x", expectedSha256: "0".repeat(64) })
    ).rejects.toBeInstanceOf(RawIntegrityError);
    expect(mem.objects.size).toBe(0);
    expect(man.rows.size).toBe(0);
  });

  it("refuses when an existing object under the key has the wrong size", async () => {
    const b = bytes("abcdef");
    mem.objects.set(rawKey(sha256Hex(b)), bytes("abc"));
    await expect(store.put(b, { kind: "text", contentType: "text/plain" })).rejects.toBeInstanceOf(RawIntegrityError);
  });

  it("handles a lost race (backend reports exists) without error", async () => {
    const b = bytes("racy");
    const original = mem.backend.head;
    mem.backend.head = async () => null; // head misses, then the conditional put finds it taken
    mem.objects.set(rawKey(sha256Hex(b)), b);
    const res = await store.put(b, { kind: "text", contentType: "text/plain" });
    expect(res.created).toBe(false);
    mem.backend.head = original;
  });
});

describe("raw store reads", () => {
  it("get re-hashes and returns the bytes", async () => {
    const b = bytes("payload");
    const { sha256 } = await store.put(b, { kind: "text", contentType: "text/plain" });
    expect(await store.get(sha256)).toEqual(b);
    expect(await store.head(sha256)).toEqual({ exists: true, sizeBytes: b.length });
  });

  it("detects corruption on read", async () => {
    const b = bytes("payload");
    const { sha256, key } = await store.put(b, { kind: "text", contentType: "text/plain" });
    mem.objects.set(key, bytes("tampered"));
    await expect(store.get(sha256)).rejects.toBeInstanceOf(RawIntegrityError);
    expect(await store.verify(sha256)).toMatchObject({ ok: false });
  });

  it("tryGet is null for missing objects; get throws", async () => {
    const sha = sha256Hex(bytes("nope"));
    expect(await store.tryGet(sha)).toBeNull();
    await expect(store.get(sha)).rejects.toThrow(/not found/);
    expect(await store.head(sha)).toEqual({ exists: false, sizeBytes: null });
  });

  it("verify needs both the object and its manifest row", async () => {
    const b = bytes("verified");
    const { sha256 } = await store.put(b, { kind: "text", contentType: "text/plain" });
    expect(await store.verify(sha256)).toEqual({ ok: true });
    man.rows.delete(sha256);
    expect(await store.verify(sha256)).toEqual({ ok: false, reason: "no manifest row" });
  });
});

describe("derived artifacts", () => {
  it("live under derived/ only and skip the manifest", async () => {
    await store.putDerived("derived/canonical/v1/x.json.gz", bytes("d"), "application/gzip");
    expect(await store.getDerived("derived/canonical/v1/x.json.gz")).toEqual(bytes("d"));
    expect(man.rows.size).toBe(0);
    await expect(store.putDerived("sha256/ab/evil", bytes("d"), "x")).rejects.toThrow(/derived/);
  });
});

describe("result shape", () => {
  it("never exposes a url", async () => {
    const res = await store.put(bytes("private"), { kind: "text", contentType: "text/plain" });
    expect(Object.keys(res).sort()).toEqual(["created", "key", "sha256", "sizeBytes"]);
  });
});

describe("r2 raw backend", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.R2_RAW_BUCKET;
    delete process.env.R2_BUCKET;
  });

  it("sends write-once + checksum headers and maps 412 to exists", async () => {
    process.env.R2_ACCOUNT_ID = "acct";
    process.env.R2_ACCESS_KEY_ID = "k";
    process.env.R2_SECRET_ACCESS_KEY = "s";
    const seen: Request[] = [];
    vi.stubGlobal("fetch", vi.fn(async (req: Request) => {
      seen.push(req);
      return new Response(null, { status: seen.length === 1 ? 200 : 412 });
    }));
    const backend = r2RawBackend("raw-bucket");
    const b = bytes("x");
    const sha = sha256Hex(b);
    expect(await backend.putIfAbsent(rawKey(sha), b, "text/plain", sha)).toBe("created");
    expect(await backend.putIfAbsent(rawKey(sha), b, "text/plain", sha)).toBe("exists");
    const req = seen[0];
    expect(req.url).toBe(`https://acct.r2.cloudflarestorage.com/raw-bucket/${rawKey(sha)}`);
    expect(req.headers.get("if-none-match")).toBe("*");
    expect(req.headers.get("x-amz-checksum-sha256")).toBe(Buffer.from(sha, "hex").toString("base64"));
  });

  it("refuses to use the public bucket as the raw bucket", () => {
    process.env.R2_BUCKET = "public";
    process.env.R2_RAW_BUCKET = "public";
    expect(() => r2RawBackend()).toThrow(/public bucket/);
  });
});
