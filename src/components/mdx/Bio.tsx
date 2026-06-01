import { mdxComponents, type MDXModule } from "./components";

export default async function Bio() {
  const mod = (await import("@content/bio.mdx")) as MDXModule;
  const Content = mod.default;
  return <Content components={mdxComponents} />;
}
