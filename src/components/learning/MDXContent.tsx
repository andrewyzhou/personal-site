import type { ComponentProps } from "react";
import type { MDXComponents } from "mdx/types";

const components: MDXComponents = {
  h1: (props: ComponentProps<"h1">) => (
    <h1
      className="font-sans font-bold text-off-white text-3xl"
      style={{ marginTop: "2rem", marginBottom: "0.75rem", letterSpacing: "-0.01em" }}
      {...props}
    />
  ),
  h2: (props: ComponentProps<"h2">) => (
    <h2
      className="font-sans font-bold text-off-white text-2xl"
      style={{ marginTop: "1.75rem", marginBottom: "0.5rem" }}
      {...props}
    />
  ),
  h3: (props: ComponentProps<"h3">) => (
    <h3
      className="font-sans font-bold text-off-white text-xl"
      style={{ marginTop: "1.25rem", marginBottom: "0.5rem" }}
      {...props}
    />
  ),
  p: (props: ComponentProps<"p">) => (
    <p
      className="font-sans text-gray text-lg leading-[1.55]"
      style={{ marginBottom: "1rem" }}
      {...props}
    />
  ),
  a: (props: ComponentProps<"a">) => {
    const isExternal = props.href?.startsWith("http");
    return (
      <a
        {...(isExternal ? { target: "_blank", rel: "noopener noreferrer" } : {})}
        className="text-off-white link-highlight"
        {...props}
      />
    );
  },
  ul: (props: ComponentProps<"ul">) => (
    <ul
      className="font-sans text-gray text-lg leading-[1.55] list-disc list-inside"
      style={{ marginBottom: "1rem", paddingLeft: "0.5rem" }}
      {...props}
    />
  ),
  ol: (props: ComponentProps<"ol">) => (
    <ol
      className="font-sans text-gray text-lg leading-[1.55] list-decimal list-inside"
      style={{ marginBottom: "1rem", paddingLeft: "0.5rem" }}
      {...props}
    />
  ),
  li: (props: ComponentProps<"li">) => (
    <li style={{ marginBottom: "0.25rem" }} {...props} />
  ),
  blockquote: (props: ComponentProps<"blockquote">) => (
    <blockquote
      className="card-bg rounded-lg font-sans text-secondary text-lg italic leading-[1.55]"
      style={{
        padding: "1rem 1.25rem",
        marginBottom: "1rem",
        borderLeft: "3px solid var(--theme-text-primary)",
      }}
      {...props}
    />
  ),
  strong: (props: ComponentProps<"strong">) => (
    <strong className="text-off-white font-bold" {...props} />
  ),
  em: (props: ComponentProps<"em">) => <em className="italic" {...props} />,
  hr: () => (
    <hr
      style={{
        border: "none",
        height: "1px",
        backgroundColor: "var(--theme-divider)",
        margin: "2rem 0",
      }}
    />
  ),
  code: (props: ComponentProps<"code">) => (
    <code
      className="font-mono text-off-white text-base"
      style={{
        backgroundColor: "var(--theme-highlight-bg)",
        padding: "0.125rem 0.375rem",
        borderRadius: "4px",
      }}
      {...props}
    />
  ),
  pre: (props: ComponentProps<"pre">) => (
    <pre
      className="card-bg rounded-lg font-mono text-secondary text-base overflow-x-auto"
      style={{ padding: "1rem 1.25rem", marginBottom: "1rem", lineHeight: 1.5 }}
      {...props}
    />
  ),
};

interface MDXModule {
  default: (props: { components?: MDXComponents }) => React.JSX.Element;
}

export default async function MDXContent({ slug }: { slug: string }) {
  const mod = (await import(`@/content/learning/${slug}.mdx`)) as MDXModule;
  const Content = mod.default;
  return <Content components={components} />;
}
