import { mdxComponents, type MDXModule } from "@/components/mdx/components";

export default async function MDXContent({ slug }: { slug: string }) {
  const mod = (await import(`@content/library/${slug}.mdx`)) as MDXModule;
  const Content = mod.default;
  return <Content components={mdxComponents} />;
}
