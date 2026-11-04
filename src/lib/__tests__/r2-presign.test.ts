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
});
