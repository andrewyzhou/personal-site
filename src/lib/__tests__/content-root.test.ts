import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("content root", () => {
  it("defaults to the repo content folder", async () => {
    vi.stubEnv("CONTENT_ROOT", "");
    const { CONTENT_ROOT, contentPath } = await import("@/lib/content-root");
    expect(CONTENT_ROOT).toBe(path.join(process.cwd(), "content"));
    expect(contentPath("blog")).toBe(path.join(process.cwd(), "content", "blog"));
  });

  it("follows CONTENT_ROOT when the design harness sets it", async () => {
    vi.stubEnv("CONTENT_ROOT", "tests/design/fixtures/content");
    const { contentPath } = await import("@/lib/content-root");
    expect(contentPath("sections.yaml")).toBe(path.resolve("tests/design/fixtures/content", "sections.yaml"));
  });

  it("fixture copy carries every content file the site reads", async () => {
    const fs = await import("fs");
    const fixture = path.resolve("tests/design/fixtures/content");
    for (const f of ["bio.mdx", "sections.yaml", "hero-quotes.yaml", "coursework.yaml"]) {
      expect(fs.existsSync(path.join(fixture, f)), f).toBe(true);
    }
  });
});
