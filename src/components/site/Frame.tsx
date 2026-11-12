import Link from "next/link";
import type { ReactNode } from "react";
import * as content from "@/content";
import type { SectionId } from "@/content/kinds";

// the frame every page under a section shares, built from the home page's
// own parts: the same canvas, a left / right band with the right side
// right-aligned, 2px dividers, the highlight tabs as navigation, the
// centered footer.
export default function Frame({
  section,
  trail,
  title,
  intro,
  aside,
  children,
}: {
  // the section this page belongs to (its tab is marked)
  section: SectionId;
  // links back up, nearest last: [{ label: "library", href: "/library" }]
  trail?: { label: string; href: string }[];
  title: ReactNode;
  intro?: string;
  // right side of the title band, right-aligned on wide screens
  aside?: ReactNode;
  children: ReactNode;
}) {
  const site = content.site();
  return (
    <main className="site-container">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <Link href="/" className="font-sans font-bold text-off-white text-3xl" style={{ letterSpacing: "-0.01em" }}>
          {site.site.name}
        </Link>
        <nav className="flex flex-wrap gap-2 md:justify-end">
          {content.sections().map((s) => (
            <Link
              key={s.id}
              href={content.urls.section(s.id)}
              aria-current={s.id === section ? "page" : undefined}
              className={`font-sans text-3xl transition-colors ${s.id === section ? "text-off-white font-medium link-highlight-active" : "text-gray link-highlight"}`}
              style={{ padding: "0px 4px 1px 4px", margin: "0 2px" }}
            >
              {site.sections[s.id].label}
            </Link>
          ))}
        </nav>
      </header>

      <div className="section-divider" />

      <section className="py-8">
        <div className="flex flex-col md:flex-row gap-6 md:gap-12 md:items-end">
          <div className="w-full md:w-3/5">
            {trail && trail.length > 0 && (
              <p className="font-sans text-gray text-base" style={{ marginBottom: "0.75rem" }}>
                {trail.map((t) => (
                  <span key={t.href}>
                    <Link href={t.href} className="link-highlight">
                      {t.label}
                    </Link>
                    <span aria-hidden="true">{" / "}</span>
                  </span>
                ))}
              </p>
            )}
            <h1 className="font-sans font-bold text-off-white text-5xl md:text-6xl" style={{ letterSpacing: "-0.02em", lineHeight: 1.05 }}>
              {title}
            </h1>
            {intro ? (
              <p className="font-sans text-gray text-lg leading-[1.35]" style={{ marginTop: "1rem" }}>
                {intro}
              </p>
            ) : null}
          </div>
          {aside ? <div className="w-full md:w-2/5 flex flex-col items-start md:items-end md:text-right font-sans text-gray text-lg leading-[1.35]">{aside}</div> : null}
        </div>
      </section>

      <div className="section-divider" />

      {children}

      <div className="section-divider" />

      <footer className="py-8 text-center">
        <p className="font-sans text-gray text-sm">{site.site.footer}</p>
      </footer>
    </main>
  );
}

// "{n} entries" with the right plural
export function countLabel(n: number, forms: { one: string; other: string }): string {
  return (n === 1 ? forms.one : forms.other).replace("{n}", String(n));
}

// what a list shows when it has nothing in it
export function Empty({ children }: { children: ReactNode }) {
  return <p className="font-sans text-gray text-lg italic">{children}</p>;
}
