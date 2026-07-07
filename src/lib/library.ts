import fs from "fs";
import path from "path";
import matter from "gray-matter";

export type LibraryType = "book" | "video" | "podcast" | "course" | "article";

export interface LibraryFrontmatter {
  title: string;
  creator: string;
  type: LibraryType;
  sourceUrl?: string;
  cover?: string; // optional header image, local path or https (cdn)
  dateStarted?: string;
  dateCompleted?: string;
  rating?: number;
  tags: string[];
  summary: string;
}

export interface LibraryEntry extends LibraryFrontmatter {
  slug: string;
  content: string;
  status: "in-progress" | "completed";
}

const CONTENT_DIR = path.join(process.cwd(), "content/library");

// subdirectories of content/library/ are intentionally not traversed — only
// direct-child .mdx files are published. drafts live in content/library/wip/
// and are skipped by this loader (and not statically generated). a wip entry
// is published by moving its file up one level into content/library/.

// slug = filename minus .mdx. must be lowercase ascii to keep urls portable
// across case-sensitive (linux prod) and case-insensitive (macos dev) hosts,
// and to keep `${slug}.mdx` in dynamic imports unambiguous. enforced on both
// ingest (getAllEntries) and lookup (getEntryBySlug) so the /library index
// can't list an entry whose detail page would 404.
function isValidSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-_]*$/.test(slug);
}

export function getAllEntries(): LibraryEntry[] {
  if (!fs.existsSync(CONTENT_DIR)) return [];

  const dirents = fs
    .readdirSync(CONTENT_DIR, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith(".mdx"));

  const entries: LibraryEntry[] = [];
  for (const d of dirents) {
    const slug = d.name.replace(/\.mdx$/, "");
    if (!isValidSlug(slug)) {
      console.warn(
        `[library] skipping ${d.name}: filename must match /^[a-z0-9][a-z0-9-_]*$/ (lowercase ascii, no spaces/dots)`
      );
      continue;
    }
    const raw = fs.readFileSync(path.join(CONTENT_DIR, d.name), "utf8");
    const { data, content } = matter(raw);
    const fm = data as LibraryFrontmatter;
    entries.push({
      ...fm,
      tags: fm.tags ?? [],
      slug,
      content,
      status: fm.dateCompleted ? "completed" : "in-progress",
    });
  }

  // sort: in-progress first (by dateStarted desc), then completed (by dateCompleted desc)
  return entries.sort((a, b) => {
    if (a.status !== b.status) return a.status === "in-progress" ? -1 : 1;
    const aDate = a.dateCompleted ?? a.dateStarted ?? "";
    const bDate = b.dateCompleted ?? b.dateStarted ?? "";
    return bDate.localeCompare(aDate);
  });
}

export function getEntryBySlug(slug: string): LibraryEntry | null {
  if (!isValidSlug(slug)) return null;
  const file = path.join(CONTENT_DIR, `${slug}.mdx`);
  // defense in depth: confirm the resolved file lives directly inside
  // CONTENT_DIR, not in a subfolder like wip/ — should already be guaranteed
  // by isValidSlug above but cheap to verify.
  if (path.dirname(file) !== CONTENT_DIR) return null;
  if (!fs.existsSync(file)) return null;
  const raw = fs.readFileSync(file, "utf8");
  const { data, content } = matter(raw);
  const fm = data as LibraryFrontmatter;
  return {
    ...fm,
    tags: fm.tags ?? [],
    slug,
    content,
    status: fm.dateCompleted ? "completed" : "in-progress",
  };
}

export function getAllTags(): string[] {
  const tags = new Set<string>();
  for (const entry of getAllEntries()) {
    for (const tag of entry.tags) tags.add(tag);
  }
  return Array.from(tags).sort();
}

export function getAdjacentEntries(slug: string): {
  prev: LibraryEntry | null;
  next: LibraryEntry | null;
} {
  const entries = getAllEntries();
  const idx = entries.findIndex((e) => e.slug === slug);
  if (idx === -1) return { prev: null, next: null };
  return {
    prev: idx > 0 ? entries[idx - 1] : null,
    next: idx < entries.length - 1 ? entries[idx + 1] : null,
  };
}
