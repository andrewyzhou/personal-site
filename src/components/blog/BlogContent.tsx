import type { MDXModule } from "@/components/mdx/components";
import { blogMdxComponents } from "./mdx";

export default async function BlogContent({ slug }: { slug: string }) {
  const mod = (await import(`@content/blog/${slug}.mdx`)) as MDXModule;
  const Content = mod.default;
  return <Content components={blogMdxComponents} />;
}
