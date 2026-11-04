import { AwsClient } from "aws4fetch";

// cloudflare r2 via the s3-compatible api, signed with aws4fetch (tiny, fetch-based,
// works in vercel functions and local scripts alike). bucket-scoped credentials.
//
// public reads go through the custom domain (R2_PUBLIC_BASE_URL, e.g.
// https://cdn.andrewzhou.org) — zero egress, cloudflare-cached. writes and
// presigned browser uploads go to the s3 endpoint.

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

let _client: AwsClient | null = null;

function client(): AwsClient {
  if (!_client) {
    _client = new AwsClient({
      accessKeyId: requireEnv("R2_ACCESS_KEY_ID"),
      secretAccessKey: requireEnv("R2_SECRET_ACCESS_KEY"),
      service: "s3",
      region: "auto",
    });
  }
  return _client;
}

function bucketEndpoint(): string {
  return `https://${requireEnv("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com/${requireEnv("R2_BUCKET")}`;
}

function encodeKey(pathname: string): string {
  return pathname.split("/").map(encodeURIComponent).join("/");
}

// public url served via the custom domain
export function r2PublicUrl(pathname: string): string {
  const base = requireEnv("R2_PUBLIC_BASE_URL").replace(/\/$/, "");
  return `${base}/${encodeKey(pathname)}`;
}

export async function r2Put(
  pathname: string,
  body: Uint8Array | ArrayBuffer,
  contentType: string
): Promise<{ url: string; pathname: string }> {
  const res = await client().fetch(`${bucketEndpoint()}/${encodeKey(pathname)}`, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: body as BodyInit,
  });
  if (!res.ok) {
    throw new Error(`r2 put failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  return { url: r2PublicUrl(pathname), pathname };
}

export async function r2Get(pathname: string): Promise<Uint8Array> {
  const res = await client().fetch(`${bucketEndpoint()}/${encodeKey(pathname)}`);
  if (!res.ok) {
    throw new Error(`r2 get failed: ${res.status} for ${pathname}`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

export async function r2Head(pathname: string): Promise<boolean> {
  const res = await client().fetch(`${bucketEndpoint()}/${encodeKey(pathname)}`, {
    method: "HEAD",
  });
  return res.ok;
}

export async function r2Delete(pathname: string): Promise<void> {
  const res = await client().fetch(`${bucketEndpoint()}/${encodeKey(pathname)}`, {
    method: "DELETE",
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`r2 delete failed: ${res.status} for ${pathname}`);
  }
}

// presigned browser PUT (photos bypass the vercel 4.5mb request cap this way).
// query-string signing; content-type is enforced by bucket cors + client code,
// not the signature.
export async function r2PresignPut(pathname: string, expiresSeconds = 600): Promise<string> {
  const url = new URL(`${bucketEndpoint()}/${encodeKey(pathname)}`);
  url.searchParams.set("X-Amz-Expires", String(expiresSeconds));
  const signed = await client().sign(new Request(url.toString(), { method: "PUT" }), {
    aws: { signQuery: true },
  });
  return signed.url;
}

// sum object sizes for the storage audit. r2 free tier is 10gb; warn early anyway.
export async function r2Usage(prefix?: string): Promise<{ totalBytes: number; count: number }> {
  let totalBytes = 0;
  let count = 0;
  let token: string | undefined;
  do {
    const url = new URL(bucketEndpoint());
    url.searchParams.set("list-type", "2");
    url.searchParams.set("max-keys", "1000");
    if (prefix) url.searchParams.set("prefix", prefix);
    if (token) url.searchParams.set("continuation-token", token);
    const res = await client().fetch(url.toString());
    if (!res.ok) {
      throw new Error(`r2 list failed: ${res.status}`);
    }
    const xml = await res.text();
    for (const m of xml.matchAll(/<Size>(\d+)<\/Size>/g)) {
      totalBytes += Number(m[1]);
      count += 1;
    }
    const next = xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/);
    token = next ? next[1] : undefined;
  } while (token);
  return { totalBytes, count };
}

// ---------------------------------------------------------------------------
// bucket-explicit object access, used by the private raw store. nothing here
// builds a public url: objects in other buckets are reachable only with
// credentials.

function endpointFor(bucket: string): string {
  return `https://${requireEnv("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com/${bucket}`;
}

export function r2BucketFetch(bucket: string, key: string, init?: RequestInit): Promise<Response> {
  return client().fetch(`${endpointFor(bucket)}/${encodeKey(key)}`, init);
}

// presigned browser PUT into any bucket. `headers` are signed into the url, so
// the browser must send exactly these (and r2 enforces them, e.g. a checksum
// or If-None-Match: * for write-once keys). content-type is never signed.
export async function r2PresignPutIn(
  bucket: string,
  key: string,
  opts: { expiresSeconds?: number; headers?: Record<string, string> } = {}
): Promise<{ url: string; headers: Record<string, string> }> {
  const url = new URL(`${endpointFor(bucket)}/${encodeKey(key)}`);
  url.searchParams.set("X-Amz-Expires", String(opts.expiresSeconds ?? 600));
  const headers = opts.headers ?? {};
  const signed = await client().sign(new Request(url.toString(), { method: "PUT", headers }), {
    aws: { signQuery: true },
  });
  return { url: signed.url, headers };
}

// list keys (and sizes) under a prefix in any bucket
export async function r2BucketList(
  bucket: string,
  prefix?: string
): Promise<{ key: string; size: number }[]> {
  const out: { key: string; size: number }[] = [];
  let token: string | undefined;
  do {
    const url = new URL(endpointFor(bucket));
    url.searchParams.set("list-type", "2");
    url.searchParams.set("max-keys", "1000");
    if (prefix) url.searchParams.set("prefix", prefix);
    if (token) url.searchParams.set("continuation-token", token);
    const res = await client().fetch(url.toString());
    if (!res.ok) throw new Error(`r2 list failed: ${res.status}`);
    const xml = await res.text();
    for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      const key = m[1].match(/<Key>([^<]+)<\/Key>/)?.[1];
      const size = m[1].match(/<Size>(\d+)<\/Size>/)?.[1];
      if (key && size) out.push({ key: decodeXmlEntities(key), size: Number(size) });
    }
    const next = xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/);
    token = next ? decodeXmlEntities(next[1]) : undefined;
  } while (token);
  return out;
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}
