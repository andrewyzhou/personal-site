import NextLink from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "./layout";

const isExternal = (href: string) => /^(https?:)?\/\//.test(href) || href.endsWith(".pdf");

// links are text: underlined in prose, quiet in navigation, never boxed
export function Link({
  href,
  variant = "standalone",
  tone,
  current,
  className,
  children,
}: {
  href: string;
  variant?: "inline" | "nav" | "standalone";
  tone?: "muted";
  current?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const props = {
    className: cx("ds-link", className),
    "data-variant": variant,
    "data-tone": tone,
    "aria-current": current ? ("page" as const) : undefined,
  };
  if (isExternal(href)) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
        {children}
      </a>
    );
  }
  return (
    <NextLink href={href} {...props}>
      {children}
    </NextLink>
  );
}

type ButtonProps = {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  href?: string;
  icon?: ReactNode;
  children?: ReactNode;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children">;

// buttons are controls: padded, a clear hit area, 44px on touch screens
export function Button({ variant = "secondary", size = "md", href, icon, children, className, ...rest }: ButtonProps) {
  const props = {
    className: cx("ds-btn", className),
    "data-variant": variant,
    "data-size": size,
    "data-icon-only": icon && !children ? "" : undefined,
  };
  const inner = (
    <>
      {icon}
      {children}
    </>
  );
  if (href) {
    return isExternal(href) ? (
      <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
        {inner}
      </a>
    ) : (
      <NextLink href={href} {...props}>
        {inner}
      </NextLink>
    );
  }
  return (
    <button type="button" {...props} {...rest}>
      {inner}
    </button>
  );
}

export function IconButton({ label, icon, ...rest }: { label: string; icon: ReactNode } & Omit<ButtonProps, "children" | "icon">) {
  return <Button variant="ghost" icon={icon} aria-label={label} title={label} {...rest} />;
}

// chips select things (filters, tabs, tags); they are never navigation chrome
export function Chip({
  selected,
  href,
  size,
  onClick,
  children,
}: {
  selected?: boolean;
  href?: string;
  size?: "md" | "lg";
  onClick?: () => void;
  children: ReactNode;
}) {
  if (href) {
    return (
      <NextLink href={href} className="ds-chip" data-size={size} aria-current={selected ? "page" : undefined}>
        {children}
      </NextLink>
    );
  }
  return (
    <button type="button" className="ds-chip" data-size={size} aria-pressed={!!selected} onClick={onClick}>
      {children}
    </button>
  );
}

export interface Crumb {
  label: string;
  href?: string;
}

// trail of parents plus the current page. on phones it collapses to a single
// "‹ parent" link with a full-size touch target.
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  const parentIndex = items.length - 2;
  return (
    <nav aria-label="breadcrumb">
      <ol className="ds-crumbs">
        {items.map((c, i) => {
          const last = i === items.length - 1;
          return (
            <li key={`${i}:${c.label}`} data-parent={i === parentIndex ? "" : undefined}>
              {last || !c.href ? (
                <span aria-current={last ? "page" : undefined}>{c.label}</span>
              ) : (
                <Link href={c.href} variant="nav">
                  {c.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
