import { notFound } from "next/navigation";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@/design-system/ds.css";
import "../_docs/docs.css";
import { BRANDS, BrandRoot, Icon, ThemeToggle, getBrand } from "@/design-system";
import { canViewDesignLab } from "../_docs/access";
import { BrandSwitch, DocsNav } from "../_docs/DocsNav";

export const metadata: Metadata = { title: "design · andrew zhou", robots: { index: false } };

export default async function DocsLayout({ params, children }: { params: Promise<{ brand: string }>; children: ReactNode }) {
  if (!(await canViewDesignLab())) notFound();
  const { brand: id } = await params;
  const brand = getBrand(id);
  if (!brand) notFound();
  return (
    <BrandRoot brand={brand} className="docs">
      <header className="docs-top">
        <a href={`/design/${brand.id}`} className="docs-title">
          <Icon src="/images/az-logo.svg" size="1.25rem" />
          <span>andrew zhou</span>
          <span>design</span>
        </a>
        <div className="docs-top-end">
          {/* the live site in the hub design (admins only until it's the default). plain
              <a> on purpose: switching needs a full load so the proxy can set the cookie */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/?design=b" className="ds-link" data-variant="nav" style={{ fontSize: "var(--ds-text-sm)" }}>
            view site in B
          </a>
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/?design=v1" className="ds-link" data-variant="nav" style={{ fontSize: "var(--ds-text-sm)" }}>
            back to v1
          </a>
          <BrandSwitch brands={Object.values(BRANDS).map((b) => ({ id: b.id, name: b.name }))} current={brand.id} />
          <ThemeToggle label="switch to {theme} mode" />
        </div>
      </header>
      <div className="docs-body">
        <DocsNav brand={brand.id} />
        <main className="docs-main">{children}</main>
      </div>
    </BrandRoot>
  );
}
