import { evaluate } from "@mdx-js/mdx";
import * as runtime from "react/jsx-runtime";
import { mdxComponents, type MDXComponents } from "@/components/mdx/components";

// renders an entry's text from the content module (server only). used where
// the text is already in hand, so a page doesn't need a per-folder import.
export default async function RenderMdx({ source, components = mdxComponents }: { source: string; components?: MDXComponents }) {
  const { default: Content } = await evaluate(source, { ...runtime, baseUrl: import.meta.url });
  return <Content components={components} />;
}
