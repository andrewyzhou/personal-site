import type { CSSProperties, ElementType, ReactNode } from "react";
import type { Space } from "../tokens";

type As = { as?: ElementType; className?: string; children?: ReactNode };

export function Stack({ gap = "4", as: Tag = "div", className, children }: As & { gap?: Space }) {
  return (
    <Tag className={cx("ds-stack", className)} data-gap={gap}>
      {children}
    </Tag>
  );
}

export function Cluster({
  gap = "2",
  justify,
  align,
  nowrap,
  as: Tag = "div",
  className,
  children,
}: As & { gap?: Space; justify?: "between" | "end"; align?: "baseline" | "start"; nowrap?: boolean }) {
  return (
    <Tag
      className={cx("ds-cluster", className)}
      data-gap={gap}
      data-justify={justify}
      data-align={align}
      data-nowrap={nowrap ? "" : undefined}
    >
      {children}
    </Tag>
  );
}

export function Grid({ min = "12rem", gap = "4", as: Tag = "div", className, children }: As & { min?: string; gap?: Space }) {
  return (
    <Tag className={cx("ds-grid", className)} data-gap={gap} style={{ "--ds-grid-min": min } as CSSProperties}>
      {children}
    </Tag>
  );
}

export function Container({
  width = "content",
  as: Tag = "div",
  className,
  children,
}: As & { width?: "prose" | "content" | "wide" }) {
  return (
    <Tag className={cx("ds-container", className)} data-width={width}>
      {children}
    </Tag>
  );
}

export function Divider() {
  return <hr className="ds-divider" />;
}

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

// a bordered surface: one record, one form, one group of settings. optional
// header row (title + actions) and a padded body.
export function Card({
  title,
  actions,
  children,
  className,
  padded = true,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <section className={cx("ds-card", className)}>
      {title || actions ? (
        <header className="ds-card-header">
          {title ? <h2 className="ds-card-title">{title}</h2> : <span />}
          {actions ? <div className="ds-card-actions">{actions}</div> : null}
        </header>
      ) : null}
      <div className={padded ? "ds-card-body" : undefined}>{children}</div>
    </section>
  );
}
