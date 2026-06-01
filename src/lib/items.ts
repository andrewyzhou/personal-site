import fs from "fs";
import path from "path";
import matter from "gray-matter";

export type ItemCategory = "work" | "research" | "teaching" | "projects";

export interface ItemMeta {
  slug: string;
  order: number;
  title: string;
  company: string;
  companyUrl?: string;
  location?: string;
  period?: string;
  year: string;
}

export function getItems(category: ItemCategory): ItemMeta[] {
  const dir = path.join(process.cwd(), "content", category);
  if (!fs.existsSync(dir)) return [];

  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".mdx"))
    .map((file) => {
      const slug = file.replace(/\.mdx$/, "");
      const raw = fs.readFileSync(path.join(dir, file), "utf8");
      const { data } = matter(raw);
      const fm = data as Omit<ItemMeta, "slug">;
      return { slug, ...fm, order: fm.order ?? 99 };
    })
    .sort((a, b) => a.order - b.order);
}
