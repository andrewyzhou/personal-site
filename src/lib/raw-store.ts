// private, content-addressed, write-once store for raw inputs (device files,
// api responses, export files, photo originals). objects live in R2_RAW_BUCKET,
// which has no public domain: nothing in this module ever builds a public url.
//
// identity is sha256 of the exact bytes. a put is idempotent (same bytes → same
// key, no overwrite), r2 verifies the checksum on upload, every read re-hashes,
// and each object gets one insert-only manifest row in raw_objects.
// derived artifacts (canonical tracks) live in the same bucket under derived/,
// outside the manifest, because they are regenerable. server-only.

import { createHash } from "crypto";
import { eq } from "drizzle-orm";
import { r2BucketFetch } from "./r2";
import { getDb, rawObjects, type RawObjectRow } from "./db";

export const RAW_KEY_PREFIX = "sha256/";
export const DERIVED_KEY_PREFIX = "derived/";

export type RawKind =
  | "device-file"
  | "strava-detail"
  | "strava-streams"
  | "strava-laps"
  | "strava-photos"
  | "intervals-activity"
  | "garmin-activity"
  | "strava-export-file"
  | "strava-export-manifest"
  | "photo-original"
  | "spotify-api"
  | "spotify-export-zip"
  | "spotify-export-file"
  | "pg-dump"
  | "text";

export interface RawPutOptions {
  kind: RawKind;
  contentType: string;
  filename?: string | null;
  metadata?: Record<string, unknown> | null;
  // when the caller already knows the sha (e.g. legacy fit_sha256), a mismatch
  // aborts before anything is written
  expectedSha256?: string;
}

export interface RawPutResult {
  sha256: string;
  key: string;
  sizeBytes: number;
  created: boolean; // false when the object was already present
}

export class RawIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RawIntegrityError";
  }
}

export class RawNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RawNotFoundError";
  }
}

export class RawTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RawTooLargeError";
  }
}

// adopting an object that something else (a presigned browser put) already
// wrote under rawKey(sha): the bytes are read back and must hash to the key
export interface RawAdoptOptions {
  kind: RawKind;
  // a function sees the verified bytes (e.g. to sniff the type) and may throw
  // to refuse the object before any manifest row exists
  contentType: string | ((bytes: Uint8Array) => string);
  filename?: string | null;
  metadata?: Record<string, unknown> | null;
  maxBytes?: number;
}

export interface RawAdoptResult extends RawPutResult {
  bytes: Uint8Array;
}

// storage + manifest are injected so the logic is testable without r2/neon
export interface RawBackend {
  head(key: string): Promise<{ size: number } | null>;
  // must never overwrite: resolves "exists" when the key is already taken
  putIfAbsent(key: string, bytes: Uint8Array, contentType: string, sha256: string): Promise<"created" | "exists">;
  get(key: string): Promise<Uint8Array | null>;
  // derived artifacts only (content-addressed keys, so overwrite is harmless)
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
}

export interface RawManifest {
  record(row: {
    sha256: string;
    key: string;
    sizeBytes: number;
    contentType: string;
    kind: string;
    originalFilename: string | null;
    metadata: Record<string, unknown> | null;
  }): Promise<void>; // insert-only, conflict-do-nothing
  find(sha256: string): Promise<RawObjectRow | null>;
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const SHA_RE = /^[0-9a-f]{64}$/;

export function isSha256(s: string): boolean {
  return SHA_RE.test(s);
}

export function rawKey(sha256: string): string {
  if (!isSha256(sha256)) throw new Error(`not a sha256: ${sha256}`);
  return `${RAW_KEY_PREFIX}${sha256.slice(0, 2)}/${sha256}`;
}

export interface RawStore {
  put(bytes: Uint8Array, opts: RawPutOptions): Promise<RawPutResult>;
  adopt(sha256: string, opts: RawAdoptOptions): Promise<RawAdoptResult>;
  head(sha256: string): Promise<{ exists: boolean; sizeBytes: number | null }>;
  get(sha256: string): Promise<Uint8Array>; // throws when missing or corrupt
  tryGet(sha256: string): Promise<Uint8Array | null>; // null when missing, throws when corrupt
  verify(sha256: string): Promise<{ ok: true } | { ok: false; reason: string }>;
  manifestRow(sha256: string): Promise<RawObjectRow | null>;
  putDerived(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  getDerived(key: string): Promise<Uint8Array | null>;
}

export function createRawStore(backend: RawBackend, manifest: RawManifest): RawStore {
  async function tryGet(sha256: string): Promise<Uint8Array | null> {
    const bytes = await backend.get(rawKey(sha256));
    if (!bytes) return null;
    const actual = sha256Hex(bytes);
    if (actual !== sha256) {
      throw new RawIntegrityError(`raw object ${sha256} is corrupt (hashes to ${actual})`);
    }
    return bytes;
  }

  return {
    async put(bytes, opts) {
      const sha256 = sha256Hex(bytes);
      if (opts.expectedSha256 && opts.expectedSha256 !== sha256) {
        throw new RawIntegrityError(`expected sha256 ${opts.expectedSha256}, bytes hash to ${sha256}`);
      }
      const key = rawKey(sha256);
      const existing = await backend.head(key);
      let created = false;
      if (existing) {
        // same key with a different size can only mean a corrupt prior write
        // size -1: the store did not report a length; the key is the content hash, so a
        // present key is the same bytes unless a write was corrupted (verify() checks that)
        if (existing.size !== -1 && existing.size !== bytes.length) {
          throw new RawIntegrityError(`raw object ${sha256} exists with size ${existing.size}, expected ${bytes.length}`);
        }
      } else {
        created = (await backend.putIfAbsent(key, bytes, opts.contentType, sha256)) === "created";
      }
      await manifest.record({
        sha256,
        key,
        sizeBytes: bytes.length,
        contentType: opts.contentType,
        kind: opts.kind,
        originalFilename: opts.filename ?? null,
        metadata: opts.metadata ?? null,
      });
      return { sha256, key, sizeBytes: bytes.length, created };
    },

    async adopt(sha256, opts) {
      const key = rawKey(sha256);
      const h = await backend.head(key);
      if (!h) throw new RawNotFoundError(`raw object ${sha256} not found`);
      if (opts.maxBytes !== undefined && h.size > opts.maxBytes) {
        throw new RawTooLargeError(`raw object ${sha256} is ${h.size} bytes (max ${opts.maxBytes})`);
      }
      const bytes = await backend.get(key);
      if (!bytes) throw new RawNotFoundError(`raw object ${sha256} not found`);
      if (opts.maxBytes !== undefined && bytes.length > opts.maxBytes) {
        throw new RawTooLargeError(`raw object ${sha256} is ${bytes.length} bytes (max ${opts.maxBytes})`);
      }
      const actual = sha256Hex(bytes);
      if (actual !== sha256) {
        // never recorded; the key stays write-once, so this needs a manual look
        throw new RawIntegrityError(`raw object ${sha256} hashes to ${actual}`);
      }
      const contentType = typeof opts.contentType === "function" ? opts.contentType(bytes) : opts.contentType;
      await manifest.record({
        sha256,
        key,
        sizeBytes: bytes.length,
        contentType,
        kind: opts.kind,
        originalFilename: opts.filename ?? null,
        metadata: opts.metadata ?? null,
      });
      return { sha256, key, sizeBytes: bytes.length, created: false, bytes };
    },

    async head(sha256) {
      const h = await backend.head(rawKey(sha256));
      return { exists: h !== null, sizeBytes: h?.size ?? null };
    },

    async get(sha256) {
      const bytes = await tryGet(sha256);
      if (!bytes) throw new Error(`raw object ${sha256} not found`);
      return bytes;
    },

    tryGet,

    async verify(sha256) {
      try {
        const bytes = await tryGet(sha256);
        if (!bytes) return { ok: false, reason: "missing" };
        const row = await manifest.find(sha256);
        if (!row) return { ok: false, reason: "no manifest row" };
        if (row.sizeBytes !== bytes.length) return { ok: false, reason: `manifest size ${row.sizeBytes} ≠ ${bytes.length}` };
        return { ok: true };
      } catch (error) {
        return { ok: false, reason: (error as Error).message };
      }
    },

    manifestRow: (sha256) => manifest.find(sha256),

    async putDerived(key, bytes, contentType) {
      if (!key.startsWith(DERIVED_KEY_PREFIX)) throw new Error(`derived keys must start with ${DERIVED_KEY_PREFIX}`);
      await backend.put(key, bytes, contentType);
    },

    async getDerived(key) {
      if (!key.startsWith(DERIVED_KEY_PREFIX)) throw new Error(`derived keys must start with ${DERIVED_KEY_PREFIX}`);
      return backend.get(key);
    },
  };
}

// ---------------------------------------------------------------------------
// r2 + neon implementations

export function isRawStoreConfigured(): boolean {
  return Boolean(process.env.R2_RAW_BUCKET);
}

// the private bucket name (exported for presigned photo-original puts)
export function rawBucket(): string {
  const bucket = process.env.R2_RAW_BUCKET;
  if (!bucket) throw new Error("R2_RAW_BUCKET is not set");
  if (bucket === process.env.R2_BUCKET) {
    // the public bucket is served from a custom domain; raw data must never land there
    throw new Error("R2_RAW_BUCKET must not be the public bucket");
  }
  return bucket;
}

export function r2RawBackend(bucket: string = rawBucket()): RawBackend {
  return {
    async head(key) {
      // identity: compressed responses (json) come back without content-length
      const res = await r2BucketFetch(bucket, key, { method: "HEAD", headers: { "Accept-Encoding": "identity" } });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`raw head failed: ${res.status} for ${key}`);
      const length = res.headers.get("content-length");
      return { size: length === null ? -1 : Number(length) };
    },
    async putIfAbsent(key, bytes, contentType, sha256) {
      const res = await r2BucketFetch(bucket, key, {
        method: "PUT",
        headers: {
          "Content-Type": contentType,
          // write-once: r2 refuses with 412 when the key already exists
          "If-None-Match": "*",
          // r2 rejects the upload when the received bytes hash differently
          "x-amz-checksum-sha256": Buffer.from(sha256, "hex").toString("base64"),
        },
        body: bytes as BodyInit,
      });
      if (res.status === 412) return "exists";
      if (!res.ok) throw new Error(`raw put failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
      return "created";
    },
    async get(key) {
      const res = await r2BucketFetch(bucket, key);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`raw get failed: ${res.status} for ${key}`);
      return new Uint8Array(await res.arrayBuffer());
    },
    async put(key, bytes, contentType) {
      const res = await r2BucketFetch(bucket, key, {
        method: "PUT",
        headers: { "Content-Type": contentType },
        body: bytes as BodyInit,
      });
      if (!res.ok) throw new Error(`derived put failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
    },
  };
}

export function dbRawManifest(): RawManifest {
  return {
    async record(row) {
      await getDb().insert(rawObjects).values(row).onConflictDoNothing();
    },
    async find(sha256) {
      const rows = await getDb().select().from(rawObjects).where(eq(rawObjects.sha256, sha256)).limit(1);
      return rows[0] ?? null;
    },
  };
}

let _store: RawStore | null = null;

export function getRawStore(): RawStore {
  if (!_store) _store = createRawStore(r2RawBackend(), dbRawManifest());
  return _store;
}
