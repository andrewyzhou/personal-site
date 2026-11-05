import NextLink from "next/link";
import type { ComponentProps, ReactNode } from "react";
import type { MDXComponents } from "mdx/types";

// how authored mdx (bio, posts, notes, work entries) renders in the design
// system. every element maps to a token-styled ds class; nothing here adds copy.

const isExternal = (href = "") => /^(https?:)?\/\//.test(href) || href.endsWith(".pdf");

function A({ href = "", children }: ComponentProps<"a">) {
  const props = { className: "ds-link", "data-variant": "inline" } as const;
  return isExternal(href) ? (
    <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
      {children}
    </a>
  ) : (
    <NextLink href={href} {...props}>
      {children}
    </NextLink>
  );
}

const text = (size: "base" | "lg") =>
  function P({ children }: { children?: ReactNode }) {
    return (
      <p className="ds-text" data-size={size} data-tone="default">
        {children}
      </p>
    );
  };

export function dsMdxComponents(size: "base" | "lg" = "base", extra: MDXComponents = {}): MDXComponents {
  return {
    p: text(size),
    a: A,
    h1: ({ children }) => (
      <h2 className="ds-heading" data-size="xl">
        {children}
      </h2>
    ),
    h2: ({ children }) => (
      <h2 className="ds-heading" data-size="xl">
        {children}
      </h2>
    ),
    h3: ({ children }) => (
      <h3 className="ds-heading" data-size="lg">
        {children}
      </h3>
    ),
    ul: ({ children }) => <ul className="ds-prose-list">{children}</ul>,
    ol: ({ children }) => <ol className="ds-prose-list">{children}</ol>,
    li: ({ children }) => <li>{children}</li>,
    blockquote: ({ children }) => <blockquote className="ds-quote">{children}</blockquote>,
    hr: () => <hr className="ds-divider" />,
    code: ({ children }) => <code className="ds-code">{children}</code>,
    pre: ({ children }) => <pre className="ds-pre">{children}</pre>,
    strong: ({ children }) => <strong style={{ color: "var(--ds-fg)", fontWeight: 600 }}>{children}</strong>,
    ...extra,
  };
}
