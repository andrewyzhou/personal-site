import { mdxComponents, type MDXModule } from "./components";
import type { ItemCategory } from "@/lib/items";

async function loadItemModule(category: ItemCategory, slug: string): Promise<MDXModule> {
  // each case keeps a static template-literal path so turbopack can statically
  // resolve the dynamic import for every item under each category folder.
  switch (category) {
    case "work":
      return (await import(`@content/work/${slug}.mdx`)) as MDXModule;
    case "research":
      return (await import(`@content/research/${slug}.mdx`)) as MDXModule;
    case "teaching":
      return (await import(`@content/teaching/${slug}.mdx`)) as MDXModule;
    case "projects":
      return (await import(`@content/projects/${slug}.mdx`)) as MDXModule;
  }
}

export default async function ItemContent({
  category,
  slug,
}: {
  category: ItemCategory;
  slug: string;
}) {
  const mod = await loadItemModule(category, slug);
  const Content = mod.default;
  return <Content components={mdxComponents} />;
}
