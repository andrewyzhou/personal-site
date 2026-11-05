// which public urls have a brand-B page (under src/app/b). the proxy serves
// those from the b tree when the viewer has opted into b; every other url
// falls through to the v1 page, so b can grow page by page.

export const SITE_DESIGN_COOKIE = "design";
export type SiteDesign = "v1" | "b";

// what visitors see. flipping this to "b" makes brand b the public site.
export const DEFAULT_SITE_DESIGN: SiteDesign = "v1";

// the internal prefix of the b tree; never shown in the address bar
export const B_PREFIX = "/b";

const B_PAGES: RegExp[] = [
  /^\/$/,
  /^\/work$/,
  /^\/writing$/,
  /^\/training$/,
  /^\/photos$/,
  /^\/blog\/[^/]+$/,
  /^\/library\/[^/]+$/,
  /^\/activities\/\d+$/,
];

export function hasBPage(pathname: string): boolean {
  return B_PAGES.some((r) => r.test(pathname));
}

// /blog and /library fold into /writing, /lifts into /training. only applied
// for b viewers; v1 keeps its own index pages.
export const B_REDIRECTS: Record<string, string> = {
  "/blog": "/writing?kind=post",
  "/library": "/writing?kind=note",
};
