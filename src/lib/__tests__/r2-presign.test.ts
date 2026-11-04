import { describe, it, expect, beforeAll, afterAll } from "vitest";

const saved = { ...process.env };
beforeAll(() => {
  process.env.R2_ACCOUNT_ID = "acct";
  process.env.R2_ACCESS_KEY_ID = "key";
  process.env.R2_SECRET_ACCESS_KEY = "secret";
});
afterAll(() => {
  for (const k of ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"]) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("r2PresignPutIn", () => {
  it("signs a put for the given bucket/key with the required headers bound into the signature", async () => {
    const { r2PresignPutIn } = await import("../r2");
    const key = `sha256/ab/${"ab".repeat(32)}`;
    const { url, headers } = await r2PresignPutIn("raw-bucket", key, {
      expiresSeconds: 900,
      headers: { "if-none-match": "*", "x-amz-checksum-sha256": "q83v" },
    });
    const u = new URL(url);
    expect(u.host).toBe("acct.r2.cloudflarestorage.com");
    expect(u.pathname).toBe(`/raw-bucket/${key}`);
    expect(u.searchParams.get("X-Amz-Expires")).toBe("900");
    expect(u.searchParams.get("X-Amz-SignedHeaders")).toBe("host;if-none-match;x-amz-checksum-sha256");
    expect(u.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
    expect(headers).toEqual({ "if-none-match": "*", "x-amz-checksum-sha256": "q83v" });
  });

  it("signs content-length when given, but leaves it for the browser to send", async () => {
    const { r2PresignPutIn } = await import("../r2");
    const fixed = { expiresSeconds: 900, headers: { "if-none-match": "*" } };
    const a = await r2PresignPutIn("raw-bucket", "k", { ...fixed, contentLength: 1234 });
    const u = new URL(a.url);
    expect(u.searchParams.get("X-Amz-SignedHeaders")).toBe("content-length;host;if-none-match");
    expect(a.headers).toEqual({ "if-none-match": "*" });
    // a different size is a different signature
    const b = await r2PresignPutIn("raw-bucket", "k", { ...fixed, contentLength: 1235 });
    const sig = (url: string) => new URL(url).searchParams.get("X-Amz-Signature");
    if (u.searchParams.get("X-Amz-Date") === new URL(b.url).searchParams.get("X-Amz-Date")) expect(sig(a.url)).not.toBe(sig(b.url));
    await expect(r2PresignPutIn("raw-bucket", "k", { contentLength: -1 })).rejects.toThrow();
  });

  it("without a content length, nothing beyond the given headers is signed", async () => {
    const { r2PresignPutIn } = await import("../r2");
    const { url } = await r2PresignPutIn("raw-bucket", "k");
    expect(new URL(url).searchParams.get("X-Amz-SignedHeaders")).toBe("host");
  });
});

describe("putHeaders (client)", () => {
  it("drops content-length and host and non-string values", async () => {
    const { putHeaders } = await import("../client/photo-original");
    expect(putHeaders({ "if-none-match": "*", "Content-Length": "5", host: "x", n: 1 })).toEqual({ "if-none-match": "*" });
    expect(putHeaders(null)).toEqual({});
  });
});
