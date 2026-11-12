"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const GROUPS: { label: string; entries: { label: string; href: string }[] }[] = [
  {
    label: "writing",
    entries: [
      { label: "blog post", href: "/admin/content/blog/new" },
      { label: "library entry", href: "/admin/content/library/new" },
    ],
  },
  {
    label: "photos",
    entries: [
      { label: "photo essay", href: "/admin/essays/new" },
      { label: "classic photoset", href: "/admin/content/photos/new" },
    ],
  },
  {
    label: "work",
    entries: [
      { label: "work item", href: "/admin/content/work/new" },
      { label: "research item", href: "/admin/content/research/new" },
      { label: "teaching item", href: "/admin/content/teaching/new" },
      { label: "project item", href: "/admin/content/projects/new" },
    ],
  },
  {
    label: "other",
    entries: [
      { label: "activity", href: "/admin/upload" },
      { label: "leetcode solution", href: "/admin/leetcode/new" },
    ],
  },
];

// "+ new" in the admin frame: a native disclosure, closed again on navigation
export default function NewEntryMenu() {
  const ref = useRef<HTMLDetailsElement>(null);
  const pathname = usePathname();
  useEffect(() => {
    ref.current?.removeAttribute("open");
  }, [pathname]);

  return (
    <details ref={ref} className="adm-new">
      <summary className="ds-btn" data-variant="primary" data-size="sm">
        + new
      </summary>
      <div className="adm-new-panel" role="menu">
        {GROUPS.map((g) => (
          <div key={g.label} className="adm-new-group">
            <span className="adm-new-label">{g.label}</span>
            {g.entries.map((e) => (
              <Link key={e.href} href={e.href} className="adm-new-item" role="menuitem">
                {e.label}
              </Link>
            ))}
          </div>
        ))}
      </div>
    </details>
  );
}
