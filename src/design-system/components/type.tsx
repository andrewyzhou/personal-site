import type { ElementType, ReactNode } from "react";
import { cx } from "./layout";

export type Tone = "fg" | "default" | "muted" | "subtle";

export function Text({
  size = "base",
  tone = "default",
  weight,
  numeric,
  as: Tag = "p",
  className,
  children,
}: {
  size?: "xs" | "sm" | "base" | "lg";
  tone?: Tone;
  weight?: "medium" | "semibold";
  numeric?: boolean;
  as?: ElementType;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <Tag className={cx("ds-text", className)} data-size={size} data-tone={tone} data-weight={weight} data-numeric={numeric ? "" : undefined}>
      {children}
    </Tag>
  );
}

const DEFAULT_SIZE = { 1: "2xl", 2: "xl", 3: "lg" } as const;

// semantic level and visual size are separate: an index page's h1 can be 3xl
export function Heading({
  level = 2,
  size,
  className,
  children,
}: {
  level?: 1 | 2 | 3;
  size?: "lg" | "xl" | "2xl" | "3xl" | "display";
  className?: string;
  children?: ReactNode;
}) {
  const Tag = `h${level}` as ElementType;
  return (
    <Tag className={cx("ds-heading", className)} data-size={size ?? DEFAULT_SIZE[level]}>
      {children}
    </Tag>
  );
}
