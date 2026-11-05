"use client";

import { usePathname } from "next/navigation";
import type { MouseEvent } from "react";
import { Link } from "./actions";
import type { NavItem } from "./shell";

// marks the section you're in. a section is current for its own page and
// everything under it (/activities is current on /activities/496). query
// strings and hashes on the item's href are ignored.
export function isCurrent(pathname: string, href: string): boolean {
  const path = href.split(/[?#]/)[0] || "/";
  if (path === "/") return pathname === "/";
  return pathname === path || pathname.startsWith(path + "/");
}

// the phone menu is a native <details>; close it once a link is chosen, since
// client-side navigation keeps the shell (and its open state) mounted
function closeMenu(e: MouseEvent<HTMLElement>) {
  e.currentTarget.closest("details")?.removeAttribute("open");
}

export function ShellNav({ items, layout }: { items: NavItem[]; layout: "bar" | "menu" }) {
  const pathname = usePathname() ?? "/";
  const menu = layout === "menu";
  return (
    <ul
      className={menu ? "ds-stack" : "ds-nav"}
      data-gap={menu ? "0" : undefined}
      style={menu ? { listStyle: "none", margin: 0, padding: 0 } : undefined}
      onClick={menu ? closeMenu : undefined}
    >
      {items.map((i) => (
        <li key={i.href}>
          <Link href={i.href} variant="nav" current={[i.href, ...(i.match ?? [])].some((h) => isCurrent(pathname, h))}>
            {i.label}
          </Link>
        </li>
      ))}
    </ul>
  );
}
