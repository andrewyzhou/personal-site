import type { MDXComponents, MDXModule } from "@/components/mdx/components";
import { blogMdxComponents } from "./mdx";

export default async function BlogContent({ slug, components = blogMdxComponents }: { slug: string; components?: MDXComponents }) {
  const mod = (await import(`@content/blog/${slug}.mdx`)) as MDXModule;
  const Content = mod.default;
  return <Content components={components} />;
}
