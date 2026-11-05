import type { CSSProperties, ReactNode } from "react";
import type { Brand } from "../brands";
import { cx } from "./layout";

// the attributes that apply a brand to everything inside: its variables
// (data-brand), its accent, and its component switches
export function brandAttrs(brand: Brand, theme?: "light" | "dark") {
  return {
    "data-brand": brand.id,
    "data-accent": brand.accent,
    "data-chip": brand.components.chip,
    "data-link": brand.components.inlineLink,
    "data-stats": brand.components.stats,
    "data-theme": theme,
  };
}

export function BrandRoot({
  brand,
  theme,
  className,
  style,
  children,
}: {
  brand: Brand;
  theme?: "light" | "dark";
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <div className={cx("ds", className)} style={style} {...brandAttrs(brand, theme)}>
      {children}
    </div>
  );
}
