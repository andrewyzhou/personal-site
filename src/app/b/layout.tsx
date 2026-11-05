import type { ReactNode } from "react";
import "@/design-system/ds.css";
import { AppShell, getBrand, type ShellModel } from "@/design-system";
import { DEFAULT_BRAND } from "@/design-system/brands";
import { getSite } from "@/content/site";

// the hub site: every page here renders in the site brand inside the one
// persistent shell. reached only through src/proxy.ts (never by its /b url).

// a hub owns the urls of the sections it gathers (training owns /activities/…)
const SECTION_PATHS: Record<string, string> = {
  blog: "/blog",
  library: "/library",
  photos: "/photos",
  activities: "/activities",
  lifts: "/lifts",
};

export function shellModel(): ShellModel {
  const site = getSite();
  return {
    mark: { label: site.site.name, href: "/", logo: "/images/az-logo.svg" },
    nav: site.hubs.map((h) => ({
      label: h.label,
      href: h.href,
      match: h.sections.map((s) => SECTION_PATHS[s]).filter(Boolean),
    })),
    footer: site.site.footer,
    labels: site.shell,
  };
}

export default function HubSiteLayout({ children }: { children: ReactNode }) {
  const brand = getBrand(DEFAULT_BRAND)!;
  return (
    <AppShell model={shellModel()} brand={brand}>
      {children}
    </AppShell>
  );
}
