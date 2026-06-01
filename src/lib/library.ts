import fs from "fs";
import path from "path";
import matter from "gray-matter";

export type LibraryType = "book" | "video" | "podcast" | "course" | "article";

export interface LibraryFrontmatter {
  title: string;
  creator: string;
  type: LibraryType;
  sourceUrl?: string;
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

export function getAllEntries(): LibraryEntry[] {
  if (!fs.existsSync(CONTENT_DIR)) return [];

  const files = fs.readdirSync(CONTENT_DIR).filter((f) => f.endsWith(".mdx"));

  const entries: LibraryEntry[] = files.map((file) => {
    const slug = file.replace(/\.mdx$/, "");
    const raw = fs.readFileSync(path.join(CONTENT_DIR, file), "utf8");
    const { data, content } = matter(raw);
    const fm = data as LibraryFrontmatter;
    return {
      ...fm,
      tags: fm.tags ?? [],
      slug,
      content,
      status: fm.dateCompleted ? "completed" : "in-progress",
    };
  });

  // sort: in-progress first (by dateStarted desc), then completed (by dateCompleted desc)
  return entries.sort((a, b) => {
    if (a.status !== b.status) return a.status === "in-progress" ? -1 : 1;
    const aDate = a.dateCompleted ?? a.dateStarted ?? "";
    const bDate = b.dateCompleted ?? b.dateStarted ?? "";
    return bDate.localeCompare(aDate);
  });
}

export function getEntryBySlug(slug: string): LibraryEntry | null {
  const file = path.join(CONTENT_DIR, `${slug}.mdx`);
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
