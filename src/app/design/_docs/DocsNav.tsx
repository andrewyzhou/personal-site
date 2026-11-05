"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { SECTIONS } from "./registry";

// the sidebar (desktop) and a page picker (phones). the brand segment is
// kept, so switching pages never switches brand.
export function DocsNav({ brand }: { brand: string }) {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const overview = `/design/${brand}`;
  const all = [{ href: overview, title: "overview", group: "" }, ...SECTIONS.flatMap((s) => s.pages.map((p) => ({ href: `/design/${brand}/${s.id}/${p.slug}`, title: p.title, group: s.title })))];
  return (
    <>
      <nav className="docs-side" aria-label="design docs">
        <ul>
          <li>
            <Link href={overview} aria-current={pathname === overview ? "page" : undefined}>
              overview
            </Link>
          </li>
        </ul>
        {SECTIONS.map((s) => (
          <div key={s.id}>
            <h4>{s.title}</h4>
            <ul>
              {s.pages.map((p) => {
                const href = `/design/${brand}/${s.id}/${p.slug}`;
                return (
                  <li key={p.slug}>
                    <Link href={href} aria-current={pathname === href ? "page" : undefined}>
                      {p.title}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      <div className="docs-mobile-nav">
        <label htmlFor="docs-page" className="ds-field-label" style={{ display: "block", marginBottom: 4 }}>
          page
        </label>
        <select id="docs-page" className="ds-input" value={all.find((a) => a.href === pathname)?.href ?? overview} onChange={(e) => router.push(e.target.value)}>
          {all.map((a) => (
            <option key={a.href} value={a.href}>
              {a.group ? `${a.group} · ${a.title}` : a.title}
            </option>
          ))}
        </select>
      </div>
    </>
  );
}

// chips that reopen the same page in another brand
export function BrandSwitch({ brands, current }: { brands: { id: string; name: string }[]; current: string }) {
  const pathname = usePathname() ?? "";
  return (
    <div className="ds-cluster" data-gap="1" role="group" aria-label="brand">
      {brands.map((b) => (
        <Link
          key={b.id}
          href={pathname.replace(/^\/design\/[^/]+/, `/design/${b.id}`)}
          className="ds-chip"
          aria-current={b.id === current ? "page" : undefined}
          title={`${b.id.toUpperCase()} · ${b.name}`}
        >
          {b.id.toUpperCase()} · {b.name}
        </Link>
      ))}
    </div>
  );
}
