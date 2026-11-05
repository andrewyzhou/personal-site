import { mdxComponents, type MDXComponents, type MDXModule } from "@/components/mdx/components";

export default async function MDXContent({ slug, components = mdxComponents }: { slug: string; components?: MDXComponents }) {
  const mod = (await import(`@content/library/${slug}.mdx`)) as MDXModule;
  const Content = mod.default;
  return <Content components={components} />;
}
