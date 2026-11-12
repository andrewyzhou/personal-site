import { beforeEach, describe, expect, it, vi } from "vitest";

// drafts in memory, the repo in memory: these tests are about where each
// operation writes, and that an unpublished entry never reaches the repo

const repo = new Map<string, string>();
const commits: string[] = [];
const drafts = new Map<string, { type: string; slug: string; frontmatter: Record<string, unknown>; body: string; sha: string }>();

vi.mock("@upstash/redis", () => ({
  Redis: class {
    async get() {
      return null;
    }
    async set() {}
    async del() {}
  },
}));

vi.mock("@/lib/log", () => ({ log: { info: () => {}, warn: () => {}, error: () => {} } }));

vi.mock("../github-content", () => {
  class GitHubNotFoundError extends Error {}
  class GitHubExistsError extends Error {}
  const blob = (content: string) => `blob-${content.length}-${[...content].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7)}`;
  const commit = (message: string) => {
    commits.push(message);
    return { commitSha: `c${commits.length}`, commitUrl: `https://example.com/c${commits.length}` };
  };
  return {
    GitHubNotFoundError,
    GitHubExistsError,
    getTree: async () => [...repo].map(([path, content]) => ({ path, type: "blob", sha: blob(content) })),
    getBlob: async (_repo: string, sha: string) => [...repo.values()].find((c) => blob(c) === sha) ?? "",
    getFile: async (_repo: string, path: string) => {
      const content = repo.get(path);
      if (content === undefined) throw new GitHubNotFoundError(path);
      return { path, sha: blob(content), content };
    },
    putFile: async (_repo: string, o: { path: string; content: string; message: string; sha?: string }) => {
      const current = repo.get(o.path);
      if (current !== undefined && blob(current) !== o.sha) throw new GitHubExistsError(o.path);
      repo.set(o.path, o.content);
      return { blobSha: blob(o.content), ...commit(o.message) };
    },
    deleteFile: async (_repo: string, o: { path: string; message: string }) => {
      repo.delete(o.path);
      return commit(o.message);
    },
    moveFile: async () => {
      throw new Error("drafts are never moved inside the repo");
    },
  };
});

vi.mock("../draft-store", async () => {
  const { createHash } = await import("node:crypto");
  const key = (type: string, slug: string) => `${type}/${slug}`;
  return {
    draftPath: (type: string, slug: string) => `draft:${type}/${slug}`,
    isDraftPath: (p: string) => p.startsWith("draft:"),
    draftSha: (s: string) => createHash("sha1").update(s).digest("hex"),
    listDrafts: async (type: string) => [...drafts.values()].filter((d) => d.type === type),
    getDraft: async (type: string, slug: string) => drafts.get(key(type, slug)) ?? null,
    insertDraft: async (d: { type: string; slug: string; frontmatter: Record<string, unknown>; body: string; sha: string }) => {
      if (drafts.has(key(d.type, d.slug))) return false;
      drafts.set(key(d.type, d.slug), d);
      return true;
    },
    updateDraft: async (d: { type: string; slug: string; frontmatter: Record<string, unknown>; body: string; sha: string }, baseSha: string) => {
      if (drafts.get(key(d.type, d.slug))?.sha !== baseSha) return false;
      drafts.set(key(d.type, d.slug), d);
      return true;
    },
    deleteDraft: async (type: string, slug: string, sha: string) => {
      if (drafts.get(key(type, slug))?.sha !== sha) return false;
      drafts.delete(key(type, slug));
      return true;
    },
  };
});

import { createEntry, deleteEntry, getContentType, listEntries, moveEntry, readEntry, updateEntry } from "../content-store";

const blog = getContentType("blog")!;
const work = getContentType("work")!;
const FM = { title: "hello", date: "2026-05-31", summary: "s", tags: [] };

beforeEach(() => {
  repo.clear();
  drafts.clear();
  commits.length = 0;
});

describe("drafts stay out of the repo", () => {
  it("creating, editing and deleting a draft makes no commit and writes no file", async () => {
    const created = await createEntry(blog, "post", FM, "first", true);
    expect(created.path).toBe("draft:blog/post");
    expect(created.commitSha).toBe("");

    const read = await readEntry(blog, "post");
    expect(read.status).toBe("wip");
    expect(read.body).toBe("first");
    expect(read.sha).toBe(created.blobSha);

    const updated = await updateEntry(blog, read.path, "post", FM, "second", read.sha);
    expect(updated.commitSha).toBe("");
    expect((await readEntry(blog, "post")).body).toBe("second");

    expect(await deleteEntry(blog, read.path, "post", updated.blobSha)).toEqual({ commitSha: "", commitUrl: "" });
    await expect(readEntry(blog, "post")).rejects.toThrow();

    expect(repo.size).toBe(0);
    expect(commits).toEqual([]);
  });

  it("refuses a draft save made from a stale copy", async () => {
    const created = await createEntry(blog, "post", FM, "first", true);
    await updateEntry(blog, created.path, "post", FM, "second", created.blobSha);
    await expect(updateEntry(blog, created.path, "post", FM, "third", created.blobSha)).rejects.toThrow();
    expect((await readEntry(blog, "post")).body).toBe("second");
  });

  it("refuses a second draft with the same name", async () => {
    await createEntry(blog, "post", FM, "first", true);
    await expect(createEntry(blog, "post", FM, "again", true)).rejects.toThrow();
  });

  it("lists drafts next to published entries", async () => {
    await createEntry(blog, "draft-one", FM, "d", true);
    await createEntry(blog, "live-one", FM, "p", false);
    const { items } = await listEntries(blog);
    expect(items.map((i) => `${i.slug}:${i.status}`).sort()).toEqual(["draft-one:wip", "live-one:published"]);
  });

  it("ignores a wip folder left in the repo", async () => {
    repo.set("content/blog/wip/old.mdx", blog.serialize(FM, "old"));
    expect((await listEntries(blog)).items).toEqual([]);
    await expect(readEntry(blog, "old")).rejects.toThrow();
  });
});

describe("publishing and unpublishing", () => {
  it("publish writes the file with one commit and removes the draft", async () => {
    const created = await createEntry(blog, "post", FM, "text", true);
    const moved = await moveEntry(blog, "post", "publish", created.blobSha);

    expect(moved.path).toBe("content/blog/post.mdx");
    expect(repo.get("content/blog/post.mdx")).toBe(blog.serialize(FM, "text"));
    expect(commits).toEqual(["content: add blog post post"]);
    expect(drafts.size).toBe(0);

    const read = await readEntry(blog, "post");
    expect(read.status).toBe("published");
    expect(read.sha).toBe(moved.sha);
  });

  it("publish refuses a draft that changed since it was opened", async () => {
    const created = await createEntry(blog, "post", FM, "text", true);
    await updateEntry(blog, created.path, "post", FM, "newer", created.blobSha);
    await expect(moveEntry(blog, "post", "publish", created.blobSha)).rejects.toThrow();
    expect(repo.size).toBe(0);
  });

  it("unpublish takes the file out of the repo and keeps its text as a draft", async () => {
    const created = await createEntry(blog, "post", FM, "text", false);
    const moved = await moveEntry(blog, "post", "unpublish", created.blobSha);

    expect(repo.has("content/blog/post.mdx")).toBe(false);
    expect(commits).toEqual(["content: add blog post post", "content: remove blog post post"]);
    const read = await readEntry(blog, "post");
    expect(read.status).toBe("wip");
    expect(read.body.trim()).toBe("text");
    expect(read.sha).toBe(moved.sha);
  });

  it("a published entry round-trips through unpublish and publish unchanged", async () => {
    const created = await createEntry(blog, "post", FM, "text", false);
    const before = repo.get("content/blog/post.mdx");
    const out = await moveEntry(blog, "post", "unpublish", created.blobSha);
    await moveEntry(blog, "post", "publish", out.sha);
    expect(repo.get("content/blog/post.mdx")).toBe(before);
  });
});

describe("kinds without drafts", () => {
  it("always write to the repo", async () => {
    const fm = { order: 1, title: "t", company: "c", year: "2026" };
    const created = await createEntry(work, "job", fm, "- did", true);
    expect(created.path).toBe("content/work/job.mdx");
    expect(commits).toEqual(["content: add work item job"]);
    expect(drafts.size).toBe(0);
  });
});

describe("tv and movies", () => {
  const screen = getContentType("screen")!;
  const fm = { title: "a movie", format: "movie", year: 1999, watches: [{ date: "2026-04-18", rating: 4.5, review: "good" }], tags: ["x"], inWriting: true };

  it("checks an entry with the site's own definition", () => {
    expect(screen.validate(fm, "")).toEqual([]);
    expect(screen.validate({ title: "a show", format: "show" }, "")).toEqual([]);
    expect(screen.validate({ ...fm, watches: [{ date: "2026-04-18", rating: 4.3 }] }, "")).toEqual(["watches[1].rating: must be 0.5 to 5 in half stars"]);
    expect(screen.validate({ ...fm, format: "book" }, "")).toEqual(["format: must be one of movie, show"]);
  });

  it("writes a file that reads back the same", () => {
    const text = screen.serialize(fm, "notes");
    expect(text).toContain("watches:\n  - date: 2026-04-18\n    rating: 4.5\n    review: good\n");
    const back = screen.parse(text);
    expect(back.frontmatter).toEqual(fm);
    expect(back.body.trim()).toBe("notes");
  });

  it("is drafted privately and published to its own folder", async () => {
    const created = await createEntry(screen, "a-movie", fm, "notes", true);
    expect(created.path).toBe("draft:screen/a-movie");
    const moved = await moveEntry(screen, "a-movie", "publish", created.blobSha);
    expect(moved.path).toBe("content/screen/a-movie.mdx");
    expect(commits).toEqual(["content: add tv or movie entry a-movie"]);
  });
});
