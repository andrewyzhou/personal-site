"use client";

import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import * as runtime from "react/jsx-runtime";

// client-side "how it renders" facsimile: compiles the current mdx with a
// client-safe mirror of the public component maps. the deployed page is the
// source of truth — this is a faithful preview, not pixel-identical rsc output.

/* eslint-disable @next/next/no-img-element, @typescript-eslint/no-explicit-any */
const previewComponents: Record<string, ComponentType<any>> = {
  h1: (p) => <h1 className="font-sans font-bold text-off-white text-3xl" style={{ margin: "1.5rem 0 0.75rem" }} {...p} />,
  h2: (p) => <h2 className="font-sans font-bold text-off-white text-2xl" style={{ margin: "1.5rem 0 0.75rem" }} {...p} />,
  h3: (p) => <h3 className="font-sans font-bold text-off-white text-xl" style={{ margin: "1.25rem 0 0.5rem" }} {...p} />,
  p: (p) => <p className="font-sans text-secondary text-base leading-relaxed" style={{ margin: "0.75rem 0" }} {...p} />,
  a: (p) => <a className="link-highlight" {...p} />,
  ul: (p) => <ul className="font-sans text-secondary text-base" style={{ paddingLeft: "1.25rem", listStyle: "disc" }} {...p} />,
  ol: (p) => <ol className="font-sans text-secondary text-base" style={{ paddingLeft: "1.25rem", listStyle: "decimal" }} {...p} />,
  blockquote: (p) => <blockquote style={{ borderLeft: "2px solid var(--theme-divider)", paddingLeft: "1rem", margin: "1rem 0" }} {...p} />,
  code: (p) => <code style={{ backgroundColor: "var(--theme-card-bg)", borderRadius: 4, padding: "0 4px" }} {...p} />,
  pre: (p) => <pre style={{ backgroundColor: "var(--theme-card-bg)", borderRadius: 8, padding: "1rem", overflowX: "auto" }} {...p} />,
  img: (p) => <img className="rounded-lg" style={{ maxWidth: "100%" }} alt={p.alt ?? ""} {...p} />,
  Figure: ({ src, caption, alt }: { src: string; caption?: string; alt?: string }) => (
    <figure style={{ margin: "1.5rem 0" }}>
      <img src={src} alt={alt ?? ""} className="rounded-lg" style={{ maxWidth: "100%" }} />
      {caption && <figcaption className="font-sans text-gray text-sm" style={{ marginTop: "0.5rem" }}>{caption}</figcaption>}
    </figure>
  ),
  Gallery: ({ children }: { children: ReactNode }) => (
    <div className="flex flex-wrap" style={{ gap: "0.75rem", margin: "1.5rem 0" }}>{children}</div>
  ),
};

export default function MdxPreview({ markdown }: { markdown: string }) {
  const [element, setElement] = useState<ReactNode>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const { evaluate } = await import("@mdx-js/mdx");
        const { default: Content } = await evaluate(markdown, {
          ...(runtime as object),
          useMDXComponents: () => previewComponents,
        } as Parameters<typeof evaluate>[1]);
        if (!cancelled) {
          setElement(<Content components={previewComponents} />);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message.split("\n")[0]);
      }
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [markdown]);

  if (error) {
    return <p className="font-sans text-gray text-sm italic mdx-preview">preview unavailable: {error}</p>;
  }
  return <div className="mdx-preview">{element}</div>;
}
