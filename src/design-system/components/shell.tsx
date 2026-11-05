import { Icon } from "./data";
import type { Brand } from "../brands";
import { brandAttrs } from "./BrandRoot";
import NextLink from "next/link";
import type { ReactNode } from "react";
import { Breadcrumbs, type Crumb } from "./actions";
import { Container, cx } from "./layout";
import { ShellNav } from "./ShellNav";
import { ThemeToggle } from "./ThemeToggle";

export interface NavItem {
  label: string;
  href: string;
}

export interface ShellModel {
  mark: { label: string; href: string; logo?: string };
  nav: NavItem[];
  footer: string;
  // accessibility labels (from site content)
  labels: { menu: string; theme: string };
}

const MenuIcon = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
    <path d="M3 6h12M3 12h12" />
  </svg>
);

// the one persistent frame every page sits in: mark, section nav, theme
// toggle, footer. "topbar" (sticky bar), "pill" (floating capsule) and "rail"
// (left column on wide screens) are the same structure styled three ways.
export function AppShell({
  model,
  brand,
  variant: variantProp,
  accent,
  theme,
  className,
  children,
}: {
  model: ShellModel;
  // a brand sets the shell variant, accent and component switches at once
  brand?: Brand;
  variant?: "topbar" | "pill" | "rail";
  accent?: "neutral" | "blue" | "amber" | "green";
  theme?: "light" | "dark";
  className?: string;
  children: ReactNode;
}) {
  const variant = variantProp ?? brand?.shell ?? "topbar";
  const attrs = brand ? brandAttrs(brand, theme) : { "data-accent": accent, "data-theme": theme };
  const bar = (
    <header className="ds-topbar">
      <Container width={variant === "rail" ? "wide" : "content"} className="ds-topbar-inner" as="div">
        <NextLink href={model.mark.href} className="ds-mark">
          {model.mark.logo ? <Icon src={model.mark.logo} size="1.25rem" /> : null}
          <span>{model.mark.label}</span>
        </NextLink>
        <ShellNav items={model.nav} layout="bar" />
        <div className="ds-topbar-end">
          <ThemeToggle label={model.labels.theme} />
          <details className="ds-menu">
            <summary className="ds-btn" data-variant="ghost" data-icon-only="" aria-label={model.labels.menu} title={model.labels.menu}>
              <MenuIcon />
            </summary>
            <div className="ds-menu-panel">
              <ShellNav items={model.nav} layout="menu" />
            </div>
          </details>
        </div>
      </Container>
    </header>
  );
  const body = (
    <>
      <main className="ds-shell-main">{children}</main>
      <footer className="ds-footer">
        <Container>{model.footer}</Container>
      </footer>
    </>
  );
  return (
    <div className={cx("ds ds-shell", className)} data-variant={variant} {...attrs}>
      {bar}
      {variant === "rail" ? <div className="ds-shell-body">{body}</div> : body}
    </div>
  );
}

// title block of a page: where you are, what this is, the facts about it
export function PageHeader({
  crumbs,
  title,
  titleSize = "2xl",
  leading,
  meta,
  actions,
}: {
  crumbs?: Crumb[];
  title: ReactNode;
  titleSize?: "xl" | "2xl" | "3xl" | "display";
  leading?: ReactNode;
  meta?: ReactNode[];
  actions?: ReactNode;
}) {
  return (
    <header className="ds-page-header">
      {crumbs && crumbs.length > 1 ? <Breadcrumbs items={crumbs} /> : null}
      <div className="ds-page-header-row">
        <div className="ds-page-header-title">
          {leading ? <span className="ds-page-header-leading">{leading}</span> : null}
          <h1 className="ds-heading" data-size={titleSize}>
            {title}
          </h1>
        </div>
        {actions}
      </div>
      {meta && meta.length > 0 ? (
        <p className="ds-page-meta">
          {meta.map((m, i) => (
            <span key={i}>{m}</span>
          ))}
        </p>
      ) : null}
    </header>
  );
}

export function Section({ title, actions, children }: { title?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="ds-section">
      {title || actions ? (
        <div className="ds-section-head">
          {title ? (
            <h2 className="ds-heading" data-size="lg">
              {title}
            </h2>
          ) : (
            <span />
          )}
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function Page({ width = "content", children }: { width?: "prose" | "content" | "wide"; children: ReactNode }) {
  return (
    <Container width={width} className="ds-page">
      {children}
    </Container>
  );
}
