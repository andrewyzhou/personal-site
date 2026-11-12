import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

// the loaders resolve content/ when the module loads, so each case imports
// a fresh copy after pointing CONTENT_ROOT where it wants
async function load(root?: string) {
  vi.resetModules();
  if (root) vi.stubEnv("CONTENT_ROOT", root);
  return import("../index");
}

function tree(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "content-"));
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body);
  }
  return root;
}

const role = (order: number, extra = "") => `---\norder: ${order}\ntitle: t\ncompany: c\nyear: "2026"\n${extra}---\n\n- did things\n`;
const post = (title: string, day: string, extra = "") => `---\ntitle: ${title}\ndate: ${day}\nsummary: s\ntags: []\n${extra}---\n\nhello\n`;
const BIO = { "bio.mdx": "hi\n" };

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the site's real content", () => {
  it("every published file matches its definition", async () => {
    const content = await load();
    expect(content.check()).toEqual([]);
  });

  it("loads every kind", async () => {
    const content = await load();
    expect(content.roles("work").length).toBeGreaterThan(0);
    expect(content.roles("research").length).toBeGreaterThan(0);
    expect(content.roles("teaching").length).toBeGreaterThan(0);
    expect(content.projects().length).toBeGreaterThan(0);
    expect(content.coursework().length).toBeGreaterThan(0);
    expect(content.quotes().length).toBeGreaterThan(0);
    expect(content.bio().length).toBeGreaterThan(0);
    expect(Object.keys(content.blurbs())).toContain("work");
    expect(content.shelves().map((s) => s.id)).toEqual(["reading", "screen", "photos", "projects", "coursework"]);
    expect(content.sections().map((s) => s.id)).toEqual(["writing", "work", "library"]);
  });

  it("lists every role once across the work section", async () => {
    const content = await load();
    const all = content.allRoles().map((r) => `${r.group}/${r.slug}`);
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("collections", () => {
  it("lists a role under its own group and the groups it names, from one file", async () => {
    const content = await load(tree({ ...BIO, "work/a.mdx": role(2, "alsoIn:\n  - research\n"), "work/b.mdx": role(1), "research/c.mdx": role(1) }));
    expect(content.roles("work").map((r) => r.slug)).toEqual(["b", "a"]);
    expect(content.roles("research").map((r) => `${r.group}/${r.slug}`)).toEqual(["research/c", "work/a"]);
    expect(content.roles("teaching")).toEqual([]);
    expect(content.allRoles()).toHaveLength(3);
  });

  it("sorts posts pinned first, then newest", async () => {
    const content = await load(tree({ ...BIO, "blog/old.mdx": post("old", "2026-01-01", "pinned: true\n"), "blog/new.mdx": post("new", "2026-06-01"), "blog/mid.mdx": post("mid", "2026-03-01") }));
    expect(content.posts().map((p) => p.slug)).toEqual(["old", "new", "mid"]);
    expect(content.post("mid")?.title).toBe("mid");
    expect(content.post("missing")).toBeNull();
    expect(content.posts()[0].body.trim()).toBe("hello");
  });

  it("reads an unquoted yaml date as a plain day", async () => {
    const content = await load(tree({ ...BIO, "blog/a.mdx": post("a", "2026-05-31") }));
    expect(content.posts()[0].date).toBe("2026-05-31");
  });

  it("never returns drafts, and reports their problems separately", async () => {
    const content = await load(tree({ ...BIO, "blog/wip/draft.mdx": "---\ntitle: unfinished\n---\n\n", "blog/wip/README.md": "notes" }));
    expect(content.posts()).toEqual([]);
    expect(content.check()).toEqual([]);
    expect(content.checkDrafts()).toEqual([{ file: "blog/wip/draft.mdx", problems: ["date: is required", "summary: is required", "tags: is required"] }]);
  });

  it("stops on a published file that does not match, naming the file and each problem", async () => {
    const content = await load(tree({ ...BIO, "blog/bad.mdx": "---\ntitle: x\ndate: someday\ntags: []\n---\n\n" }));
    expect(content.check()).toEqual([{ file: "blog/bad.mdx", problems: ["date: must be a date like 2026-05-31", "summary: is required"] }]);
    expect(() => content.posts()).toThrowError(/blog\/bad\.mdx[\s\S]*date: must be a date[\s\S]*summary: is required/);
  });

  it("rejects a file name that cannot be a url", async () => {
    const content = await load(tree({ ...BIO, "projects/My Project.mdx": role(1) }));
    expect(content.check()[0].problems).toEqual(["file name must be lowercase letters, digits, - or _"]);
  });

  it("an empty site has empty shelves and no writing", async () => {
    const content = await load(tree(BIO));
    expect(content.shelves().every((s) => s.count === 0)).toBe(true);
    expect(content.writing()).toEqual([]);
    expect(content.quotes()).toEqual([]);
    expect(content.blurbs()).toEqual({});
  });

  it("requires a bio", async () => {
    const content = await load(tree({}));
    expect(content.check()).toEqual([{ file: "bio.mdx", problems: ["bio cannot be empty"] }]);
  });
});

describe("writing and shelves", () => {
  const reading = (day: string, extra = "") => `---\ntitle: r\ncreator: c\ndateCompleted: ${day}\ntags: []\nsummary: s\n${extra}---\n\nnote\n`;
  const screen = (day: string, extra = "") => `---\ntitle: m\nformat: movie\nwatches:\n  - date: ${day}\n    rating: 4.5\ntags: []\n${extra}---\n\nnote\n`;

  it("writing lists posts plus only the notes that opted in, newest first", async () => {
    const content = await load(
      tree({
        ...BIO,
        "blog/p.mdx": post("p", "2026-03-01"),
        "library/in.mdx": reading("2026-04-01", "inWriting: true\n"),
        "library/out.mdx": reading("2026-05-01"),
        "screen/in.mdx": screen("2026-02-01", "inWriting: true\n"),
      }),
    );
    expect(content.writing().map((w) => `${w.kind}:${w.entry.slug}:${w.date}`)).toEqual(["reading:in:2026-04-01", "post:p:2026-03-01", "screen:in:2026-02-01"]);
  });

  it("counts each shelf and finds its latest day", async () => {
    const content = await load(tree({ ...BIO, "library/a.mdx": reading("2026-04-01"), "library/b.mdx": reading("2026-05-01"), "screen/m.mdx": screen("2026-02-01"), "projects/x.mdx": role(1) }));
    const by = Object.fromEntries(content.shelves().map((s) => [s.id, s]));
    expect(by.reading).toEqual({ id: "reading", count: 2, updated: "2026-05-01" });
    expect(by.screen).toEqual({ id: "screen", count: 1, updated: "2026-02-01" });
    expect(by.projects.count).toBe(1);
    expect(by.photos.count).toBe(0);
  });

  it("keeps every viewing of a rewatched movie, newest first", async () => {
    const twice = "---\ntitle: m\nformat: movie\nwatches:\n  - date: 2024-01-01\n    rating: 3\n    review: fine\n  - date: 2026-02-01\n    rating: 4.5\n    review: better the second time\ntags: []\n---\n\n";
    const content = await load(tree({ ...BIO, "screen/twice.mdx": twice, "screen/later.mdx": "---\ntitle: l\nformat: show\nwatches: []\ntags: []\n---\n\n" }));
    const [first, second] = content.screen();
    expect(first.slug).toBe("twice");
    expect(first.watches.map((w) => w.date)).toEqual(["2026-02-01", "2024-01-01"]);
    expect(first.latest).toEqual({ date: "2026-02-01", rating: 4.5, review: "better the second time" });
    expect(first.rewatches).toBe(1);
    expect(second.latest).toBeUndefined();
  });

  it("only accepts ratings in half stars", async () => {
    const bad = "---\ntitle: m\nformat: movie\nwatches:\n  - date: 2026-02-01\n    rating: 4.3\ntags: []\n---\n\n";
    const content = await load(tree({ ...BIO, "screen/bad.mdx": bad }));
    expect(content.check()).toEqual([{ file: "screen/bad.mdx", problems: ["watches[1].rating: must be 0.5 to 5 in half stars"] }]);
  });

  it("orders reading with what is in progress first", async () => {
    const content = await load(tree({ ...BIO, "library/done.mdx": reading("2026-05-01"), "library/now.mdx": "---\ntitle: r\ncreator: c\ndateStarted: 2026-01-01\ntags: []\nsummary: s\n---\n\n" }));
    expect(content.reading().map((r) => `${r.slug}:${r.status}`)).toEqual(["now:in-progress", "done:completed"]);
  });
});

describe("lists a file leaves out", () => {
  it("read as empty instead of failing", async () => {
    const content = await load(
      tree({
        ...BIO,
        "blog/bare.mdx": "---\ntitle: t\ndate: 2026-05-31\nsummary: s\n---\n\nbody\n",
        "screen/bare.mdx": "---\ntitle: m\nformat: show\n---\n\n",
      }),
    );
    expect(content.check()).toEqual([]);
    expect(content.posts()[0].tags).toEqual([]);
    expect(content.screen()[0]).toMatchObject({ tags: [], watches: [], rewatches: 0 });
  });
});
