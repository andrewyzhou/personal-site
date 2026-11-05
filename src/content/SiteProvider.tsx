"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { SiteContent } from "./site-types";

// hands content/site.yaml (loaded on the server in the root layout) to client
// components, so none of them hardcode copy
const SiteContext = createContext<SiteContent | null>(null);

export function SiteProvider({ site, children }: { site: SiteContent; children: ReactNode }) {
  return <SiteContext.Provider value={site}>{children}</SiteContext.Provider>;
}

export function useSite(): SiteContent {
  const site = useContext(SiteContext);
  if (!site) throw new Error("useSite() needs <SiteProvider> (root layout)");
  return site;
}
