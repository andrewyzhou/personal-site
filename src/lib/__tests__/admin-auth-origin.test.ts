import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../auth", () => ({ getSessionUser: async () => ({ isAdmin: true }) }));

import { isAdminRequest } from "../admin-auth";

const post = (url: string, origin?: string) =>
  new Request(url, { method: "POST", headers: origin ? { origin } : {} });

describe("admin origin check", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://127.0.0.1:3000");
    vi.stubEnv("ADMIN_API_SECRET", "");
  });

  it("accepts the www and apex hosts even when the site url env is loopback", async () => {
    expect(await isAdminRequest(post("https://www.andrewzhou.org/api/x", "https://www.andrewzhou.org"))).toBe(true);
    expect(await isAdminRequest(post("https://andrewzhou.org/api/x", "https://andrewzhou.org"))).toBe(true);
  });

  it("accepts the request's own origin (preview deployments)", async () => {
    expect(await isAdminRequest(post("https://personal-site-abc.vercel.app/api/x", "https://personal-site-abc.vercel.app"))).toBe(true);
  });

  it("rejects foreign origins", async () => {
    expect(await isAdminRequest(post("https://www.andrewzhou.org/api/x", "https://evil.example"))).toBe(false);
  });

  it("allows requests without an origin header", async () => {
    expect(await isAdminRequest(post("https://www.andrewzhou.org/api/x"))).toBe(true);
  });
});
