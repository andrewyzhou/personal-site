import NextLink from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { cx } from "./layout";

export interface StatModel {
  label: string;
  value: string;
  unit?: string;
}

// big number, small label
export function Stat({ value, unit, label, size = "lg" }: StatModel & { size?: "hero" | "lg" | "md" | "sm" }) {
  return (
    <div className="ds-stat" data-size={size}>
      <span className="ds-stat-value">
        {value}
        {unit ? <span className="ds-stat-unit">{unit}</span> : null}
      </span>
      <span className="ds-stat-label">{label}</span>
    </div>
  );
}

export function StatGrid({ stats, size = "lg", columns }: { stats: StatModel[]; size?: "hero" | "lg" | "md" | "sm"; columns?: 2 | 4 }) {
  return (
    <div className="ds-stat-grid" data-columns={columns}>
      {stats.map((s) => (
        <Stat key={s.label} {...s} size={size} />
      ))}
    </div>
  );
}

export function KeyValue({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="ds-kv">
      {items.map((i) => (
        <div key={i.label} style={{ display: "contents" }}>
          <dt>{i.label}</dt>
          <dd>{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}

// one row of an index: a hover wash instead of a card
export function ListRow({
  href,
  leading,
  title,
  meta,
  trailing,
  selected,
  onClick,
}: {
  href?: string;
  leading?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  trailing?: ReactNode;
  selected?: boolean;
  onClick?: () => void;
}) {
  const inner = (
    <>
      {leading ? <span className="ds-row-leading">{leading}</span> : null}
      <span style={{ minWidth: 0 }}>
        <span className="ds-row-title" style={{ display: "block" }}>
          {title}
        </span>
        {meta ? (
          <span className="ds-row-meta" style={{ display: "block" }}>
            {meta}
          </span>
        ) : null}
      </span>
      {trailing ? <span className="ds-row-trailing">{trailing}</span> : <span />}
    </>
  );
  const common = { className: "ds-row", "data-leading": leading ? "" : undefined, "aria-current": selected ? ("true" as const) : undefined };
  if (href)
    return (
      <NextLink href={href} {...common}>
        {inner}
      </NextLink>
    );
  if (onClick)
    return (
      <button type="button" onClick={onClick} {...common} style={{ width: "100%", textAlign: "left", font: "inherit", border: 0, background: "none", cursor: "pointer" }}>
        {inner}
      </button>
    );
  return <div {...common}>{inner}</div>;
}

export function List({ children }: { children: ReactNode }) {
  return <div className="ds-list">{children}</div>;
}

export interface Column<T> {
  key: string;
  header: string;
  align?: "right";
  cell: (row: T) => ReactNode;
}

export function Table<T>({ columns, rows, rowKey }: { columns: Column<T>[]; rows: T[]; rowKey: (row: T) => string }) {
  return (
    <table className="ds-table">
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={c.key} data-align={c.align}>
              {c.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={rowKey(r)}>
            {columns.map((c) => (
              <td key={c.key} data-align={c.align}>
                {c.cell(r)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Badge({ tone = "neutral", children }: { tone?: "neutral" | "pr" | "accent"; children: ReactNode }) {
  return (
    <span className="ds-badge" data-tone={tone}>
      {children}
    </span>
  );
}

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <ul className="ds-legend">
      {items.map((i) => (
        <li key={i.label}>
          <span className="ds-swatch" style={{ background: i.color } as CSSProperties} />
          {i.label}
        </li>
      ))}
    </ul>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="ds-empty">
      <span className="ds-empty-title">{title}</span>
      {body ? <span>{body}</span> : null}
      {action}
    </div>
  );
}

export function Skeleton({ width = "100%", height = "1rem", className }: { width?: string; height?: string; className?: string }) {
  return <div className={cx("ds-skeleton", className)} style={{ width, height }} aria-hidden />;
}

// a monochrome svg from /public drawn in the current text color
export function Icon({ src, size = "1.125rem", label }: { src: string; size?: string; label?: string }) {
  return (
    <span
      className="ds-icon"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={{ "--ds-icon": `url("${src}")`, "--ds-icon-size": size } as CSSProperties}
    />
  );
}

// frame for a map: border, radius, aspect, and token-styled maplibre chrome.
// the map library mounts inside; the frame owns everything visual around it.
export function MapFrame({
  aspect,
  aspectMobile,
  bleed,
  caption,
  children,
}: {
  aspect?: string;
  aspectMobile?: string;
  bleed?: boolean;
  caption?: ReactNode;
  children?: ReactNode;
}) {
  const style = {
    ...(aspect ? { "--ds-map-aspect": aspect } : {}),
    ...(aspectMobile ? { "--ds-map-aspect-mobile": aspectMobile } : {}),
  } as CSSProperties;
  return (
    <figure style={{ margin: 0 }}>
      <div className="ds-map-frame" data-bleed={bleed ? "" : undefined} style={style}>
        {children}
      </div>
      {caption ? <figcaption className="ds-map-caption">{caption}</figcaption> : null}
    </figure>
  );
}
