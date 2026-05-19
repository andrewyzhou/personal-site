import type { MDXComponents } from "mdx/types";

// default mdx components are applied per-render via the components prop on the
// imported mdx module's default export; see src/components/learning/MDXContent.tsx.
// this file exists to satisfy the @next/mdx convention.
export function useMDXComponents(components: MDXComponents): MDXComponents {
  return { ...components };
}
