import { describe, it, expect } from "vitest";
import { parseMdx, serializeMdx, serializeYamlFile, parseYamlFile } from "../admin/frontmatter";
import { CONTENT_TYPES } from "../admin/content-registry";
import { filterComment } from "../engagement";
import { flattenBlocks, hasTextContent, IMAGE_STEP_MS, TEXT_STEP_MS } from "../essay-steps";
import { courseHasDetail, semesterShortLabel } from "../coursework";
import { slugFromUrl } from "../admin/leetcode-lookup";
import type { EssayBlock } from "../photos";

describe("frontmatter round-trip", () => {
  it("blog post survives serialize → parse with unquoted dates and preserved tags", () => {
    const fm = { title: "hello", date: "2026-07-06", summary: "a post", tags: ["a", "b"], pinned: true };
    const body = "# hi\n\nsome text";
    const raw = CONTENT_TYPES.blog.serialize(fm, body);
    expect(raw).toContain("date: 2026-07-06"); // unquoted
    const back = parseMdx(raw);
    expect(back.frontmatter).toEqual(fm);
    expect(back.body.trim()).toBe(body);
  });

  it("omits empty optionals and false pinned", () => {
    const raw = CONTENT_TYPES.blog.serialize(
      { title: "x", date: "2026-01-01", summary: "s", tags: [], cover: "", pinned: false },
      "body"
    );
    expect(raw).not.toContain("cover");
    expect(raw).not.toContain("pinned");
    expect(raw).toContain("tags: []");
  });

  it("experience year stays a string through the round-trip", () => {
    const raw = CONTENT_TYPES.work.serialize({ order: 1, title: "t", company: "c", year: "2026" }, "b");
    const back = parseMdx(raw);
    expect(back.frontmatter.year).toBe("2026");
    expect(typeof back.frontmatter.year).toBe("string");
  });

  it("hero quotes multiline text survives yaml round-trip", () => {
    const data = [{ text: "line one\nline two", attribution: "someone" }];
    const raw = serializeYamlFile(data);
    const back = parseYamlFile(raw);
    expect(back.frontmatter.value).toEqual(data);
  });

  it("bio (no frontmatter) serializes to plain body", () => {
    expect(serializeMdx({}, "just text", [])).toBe("just text\n");
  });
});

describe("content validators", () => {
  it("catches missing required blog fields", () => {
    const errors = CONTENT_TYPES.blog.validate({ title: "x" }, "");
    expect(errors.some((e) => e.includes("date"))).toBe(true);
    expect(errors.some((e) => e.includes("summary"))).toBe(true);
  });

  it("rejects out-of-range library rating", () => {
    const errors = CONTENT_TYPES.library.validate(
      { title: "t", creator: "c", type: "book", tags: [], summary: "s", rating: 7 },
      ""
    );
    expect(errors.some((e) => e.includes("rating"))).toBe(true);
  });

  it("accepts a blocks-format photo essay", () => {
    const errors = CONTENT_TYPES.photos.validate(
      { format: "blocks", title: "t", date: "2026-07-06", blocks: [{ kind: "text", body: "hi" }] },
      ""
    );
    expect(errors).toEqual([]);
  });
});

describe("comment filter", () => {
  const base = { body: "nice post, love the route map!", authorName: "sam", honeypot: "" };

  it("passes a normal comment", () => {
    expect(filterComment(base)).toBeNull();
  });

  it("silently flags honeypot fills", () => {
    expect(filterComment({ ...base, honeypot: "http://spam.example" })).toBe("rejected");
  });

  it("rejects blocked words, too many links, and bad lengths", () => {
    expect(filterComment({ ...base, body: "buy viagra now" })).toContain("blocked");
    expect(filterComment({ ...base, body: "https://a.com and https://b.com" })).toContain("link");
    expect(filterComment({ ...base, body: "x" })).toContain("short");
    expect(filterComment({ ...base, body: "y".repeat(3000) })).toContain("long");
  });
});

describe("essay steps", () => {
  const blocks: EssayBlock[] = [
    { kind: "text", body: "intro" },
    { kind: "image", image: { src: "/x.jpg", width: 10, height: 10, alt: "a" } },
    {
      kind: "gallery",
      images: [
        { src: "/g1.jpg", width: 10, height: 10, alt: "g1" },
        { src: "/g2.jpg", width: 10, height: 10, alt: "g2" },
      ],
    },
  ];

  it("flattens blocks into ordered steps with durations and gallery positions", () => {
    const steps = flattenBlocks(blocks);
    expect(steps).toHaveLength(4);
    expect(steps[0].type).toBe("text");
    expect(steps[0].durationMs).toBe(TEXT_STEP_MS);
    expect(steps[1].durationMs).toBe(IMAGE_STEP_MS);
    expect(steps[2].galleryPosition).toEqual({ index: 0, count: 2 });
    expect(steps[3].galleryPosition).toEqual({ index: 1, count: 2 });
  });

  it("detects text content (drives start-paused)", () => {
    expect(hasTextContent(blocks)).toBe(true);
    expect(hasTextContent([blocks[1]])).toBe(false);
    expect(
      hasTextContent([{ kind: "image", image: { src: "/x.jpg", width: 1, height: 1, alt: "", text: "note" } }])
    ).toBe(true);
  });
});

describe("coursework helpers", () => {
  it("courseHasDetail: cheatsheets alone do not count", () => {
    expect(courseHasDetail({ code: "cs 61a", title: "sicp", cheatsheets: [{ label: "mt", url: "/x" }] })).toBe(false);
    expect(courseHasDetail({ code: "cs 161", title: "security", review: "great" })).toBe(true);
    expect(courseHasDetail({ code: "cs 170", title: "algos", links: [{ label: "notes", url: "/n" }] })).toBe(true);
  });

  it("semesterShortLabel compresses names", () => {
    expect(semesterShortLabel("fall 2025")).toBe("fa25");
    expect(semesterShortLabel("spring 2026")).toBe("sp26");
    expect(semesterShortLabel("random")).toBe("random");
  });
});

describe("leetcode url parsing", () => {
  it("extracts slugs and rejects junk", () => {
    expect(slugFromUrl("https://leetcode.com/problems/two-sum/")).toBe("two-sum");
    expect(slugFromUrl("https://leetcode.com/problems/two-sum/description/")).toBe("two-sum");
    expect(slugFromUrl("https://leetcode.cn/problems/two-sum/")).toBeNull();
    expect(slugFromUrl("https://evil.com/problems/x/")).toBeNull();
  });
});
