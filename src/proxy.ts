import { NextResponse, type NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { B_PREFIX, B_REDIRECTS, DEFAULT_SITE_DESIGN, SITE_DESIGN_COOKIE, hasBPage, type SiteDesign } from "@/designs/routes";

// picks the site design per request without making any page dynamic:
// - ?design=b / ?design=v1 sets (or clears) a cookie, then redirects to the
//   clean url. while b is unreleased only admins may opt in.
// - with b chosen, urls that have a b page are rewritten into the b tree
//   (src/app/b). the address bar never changes.
// - the b tree is never addressable directly.
export async function proxy(req: NextRequest) {
  const url = req.nextUrl;

  // the internal tree is not a public url
  if (url.pathname === B_PREFIX || url.pathname.startsWith(B_PREFIX + "/")) {
    const clean = url.clone();
    clean.pathname = url.pathname.slice(B_PREFIX.length) || "/";
    return NextResponse.redirect(clean, 308);
  }

  const asked = url.searchParams.get("design");
  if (asked === "b" || asked === "v1") {
    const clean = url.clone();
    clean.searchParams.delete("design");
    const res = NextResponse.redirect(clean, 307);
    if (asked === DEFAULT_SITE_DESIGN) {
      res.cookies.delete(SITE_DESIGN_COOKIE);
    } else if (DEFAULT_SITE_DESIGN === "b" || (await isAdmin())) {
      res.cookies.set(SITE_DESIGN_COOKIE, asked, { path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
    }
    return res;
  }

  const chosen = (req.cookies.get(SITE_DESIGN_COOKIE)?.value as SiteDesign | undefined) ?? DEFAULT_SITE_DESIGN;
  if (chosen !== "b") return NextResponse.next();

  const redirect = B_REDIRECTS[url.pathname];
  if (redirect) return NextResponse.redirect(new URL(redirect, url), 307);

  if (!hasBPage(url.pathname)) return NextResponse.next();
  const target = url.clone();
  target.pathname = B_PREFIX + (url.pathname === "/" ? "" : url.pathname);
  return NextResponse.rewrite(target);
}

async function isAdmin(): Promise<boolean> {
  if (process.env.DESIGN_FIXTURES === "1" && process.env.VERCEL_ENV !== "production") return true;
  try {
    return (await getSessionUser())?.isAdmin === true;
  } catch {
    return false;
  }
}

export const config = {
  // pages only: no api, admin, design docs, next internals or files with an extension
  matcher: ["/((?!api|admin|design|_next|.*\\.[a-zA-Z0-9]+$).*)"],
};
