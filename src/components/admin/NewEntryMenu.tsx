"use client";

import { useState } from "react";
import Link from "next/link";

const ENTRIES = [
  { label: "blog post", href: "/admin/content/blog/new" },
  { label: "library entry", href: "/admin/content/library/new" },
  { label: "photo essay", href: "/admin/content/photos/new" },
  { label: "activity", href: "/admin/upload" },
  { label: "leetcode solution", href: "/admin/leetcode/new" },
  { label: "work item", href: "/admin/content/work/new" },
  { label: "research item", href: "/admin/content/research/new" },
  { label: "teaching item", href: "/admin/content/teaching/new" },
  { label: "project item", href: "/admin/content/projects/new" },
];

export default function NewEntryMenu() {
  const [open, setOpen] = useState(false);

  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={`font-sans text-lg ${open ? "text-off-white link-highlight-active" : "text-gray link-highlight"}`}
        style={{ padding: "2px 10px" }}
        aria-label="new entry"
      >
        +
      </button>
      {open && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 30 }} onClick={() => setOpen(false)} />
          <div
            className="card-bg rounded-lg flex flex-col"
            style={{
              position: "absolute",
              right: 0,
              top: "2.2rem",
              zIndex: 31,
              padding: "8px",
              gap: "2px",
              minWidth: "180px",
              backgroundColor: "var(--theme-bg)",
              border: "1px solid var(--theme-divider)",
            }}
          >
            {ENTRIES.map((e) => (
              <Link
                key={e.href}
                href={e.href}
                onClick={() => setOpen(false)}
                className="font-sans text-gray text-sm link-highlight rounded"
                style={{ padding: "6px 8px" }}
              >
                {e.label}
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
