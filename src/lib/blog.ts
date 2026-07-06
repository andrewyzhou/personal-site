import fs from "fs";
import path from "path";
import matter from "gray-matter";

export interface BlogFrontmatter {
  title: string;
  date: string; // ISO date (yyyy-mm-dd) — publish date, also drives sort order
  summary: string;
  tags: string[];
  cover?: string; // optional hero image, e.g. /blog/my-post/cover.jpg
  pinned?: boolean; // pinned posts sort first everywhere (home blog tab + /blog index)
}

export interface BlogPost extends BlogFrontmatter {
  slug: string;
  content: string;
}

const CONTENT_DIR = path.join(process.cwd(), "content/blog");

// subdirectories of content/blog/ are intentionally not traversed — only
// direct-child .mdx files are published. drafts live in content/blog/wip/
// and are skipped by this loader (and not statically generated). a wip post
// is published by moving its file up one level into content/blog/.

// slug = filename minus .mdx. must be lowercase ascii to keep urls portable
// across case-sensitive (linux prod) and case-insensitive (macos dev) hosts,
// and to keep `${slug}.mdx` in dynamic imports unambiguous. enforced on both
// ingest (getAllPosts) and lookup (getPostBySlug) so the /blog index can't
// list a post whose detail page would 404.
function isValidSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-_]*$/.test(slug);
}

// yaml parses an unquoted `date: 2026-05-31` into a Date object, while a quoted
// "2026-05-31" stays a string. normalize both to a yyyy-mm-dd string so the
// rest of the app can treat `date` as a plain ISO string.
function toISODate(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "string") return value;
  return "";
}

export function getAllPosts(): BlogPost[] {
  if (!fs.existsSync(CONTENT_DIR)) return [];

  const dirents = fs
    .readdirSync(CONTENT_DIR, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith(".mdx"));

  const posts: BlogPost[] = [];
  for (const d of dirents) {
    const slug = d.name.replace(/\.mdx$/, "");
    if (!isValidSlug(slug)) {
      console.warn(
        `[blog] skipping ${d.name}: filename must match /^[a-z0-9][a-z0-9-_]*$/ (lowercase ascii, no spaces/dots)`
      );
      continue;
    }
    const raw = fs.readFileSync(path.join(CONTENT_DIR, d.name), "utf8");
    const { data, content } = matter(raw);
    const fm = data as BlogFrontmatter;
    posts.push({
      ...fm,
      date: toISODate(data.date),
      tags: fm.tags ?? [],
      slug,
      content,
    });
  }

  // pinned first, then newest first
  return posts.sort((a, b) => {
    if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
    return (b.date ?? "").localeCompare(a.date ?? "");
  });
}

export function getPostBySlug(slug: string): BlogPost | null {
  if (!isValidSlug(slug)) return null;
  const file = path.join(CONTENT_DIR, `${slug}.mdx`);
  // defense in depth: confirm the resolved file lives directly inside
  // CONTENT_DIR, not in a subfolder like wip/ — should already be guaranteed
  // by isValidSlug above but cheap to verify.
  if (path.dirname(file) !== CONTENT_DIR) return null;
  if (!fs.existsSync(file)) return null;
  const raw = fs.readFileSync(file, "utf8");
  const { data, content } = matter(raw);
  const fm = data as BlogFrontmatter;
  return {
    ...fm,
    date: toISODate(data.date),
    tags: fm.tags ?? [],
    slug,
    content,
  };
}

export function getAllTags(): string[] {
  const tags = new Set<string>();
  for (const post of getAllPosts()) {
    for (const tag of post.tags) tags.add(tag);
  }
  return Array.from(tags).sort();
}

export function getAdjacentPosts(slug: string): {
  prev: BlogPost | null;
  next: BlogPost | null;
} {
  const posts = getAllPosts();
  const idx = posts.findIndex((p) => p.slug === slug);
  if (idx === -1) return { prev: null, next: null };
  return {
    prev: idx > 0 ? posts[idx - 1] : null,
    next: idx < posts.length - 1 ? posts[idx + 1] : null,
  };
}
