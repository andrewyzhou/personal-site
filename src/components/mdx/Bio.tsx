import { mdxComponents, type MDXComponents, type MDXModule } from "./components";

export default async function Bio({ components = mdxComponents }: { components?: MDXComponents } = {}) {
  const mod = (await import("@content/bio.mdx")) as MDXModule;
  const Content = mod.default;
  return <Content components={components} />;
}
