import Link from "next/link";
import type { Metadata } from "next";
import { getAllEntries, getAllTags } from "@/lib/library";
import LibraryIndex from "@/components/library/LibraryIndex";
import { getSite, pageTitle } from "@/content/site";

const site = getSite();

export const metadata: Metadata = {
  title: pageTitle(site, site.pages.library.title),
  description: site.pages.library.metaDescription,
};

export default function LibraryPage() {
  const entries = getAllEntries();
  const allTags = getAllTags();

  return (
    <main className="site-container">
      <section className="py-8">
        <Link
          href="/"
          className="font-sans text-gray text-base link-highlight"
        >
          {`← ${site.nav.home}`}
        </Link>
      </section>

      <section className="py-8">
        <h1 className="font-sans font-bold text-off-white text-6xl" style={{ letterSpacing: "-0.02em", marginBottom: "1rem" }}>
          {site.pages.library.title}
        </h1>
        <p className="font-sans text-gray text-lg leading-[1.35] max-w-2xl">
          {site.pages.library.intro}
        </p>
      </section>

      <div className="section-divider" />

      <section className="py-8">
        <LibraryIndex entries={entries} allTags={allTags} />
      </section>

      <div className="section-divider" />

      <footer className="py-8 text-center">
        <p className="font-sans text-gray text-sm">{site.site.footer}</p>
      </footer>
    </main>
  );
}
