import Link from "next/link";
import type { Metadata } from "next";
import { getAllEntries, getAllTags } from "@/lib/library";
import LibraryIndex from "@/components/library/LibraryIndex";

export const metadata: Metadata = {
  title: "library · andrew zhou",
  description: "books, videos, podcasts, and courses i've been learning from, with my notes.",
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
          ← home
        </Link>
      </section>

      <section className="py-8">
        <h1 className="font-sans font-bold text-off-white text-6xl" style={{ letterSpacing: "-0.02em", marginBottom: "1rem" }}>
          library
        </h1>
        <p className="font-sans text-gray text-lg leading-[1.35] max-w-2xl">
          a running list of books, videos, podcasts, and courses i&apos;ve been learning from — with summaries, commentary, and what stuck. mostly non-technical, occasionally technical, always honest.
        </p>
      </section>

      <div className="section-divider" />

      <section className="py-8">
        <LibraryIndex entries={entries} allTags={allTags} />
      </section>

      <div className="section-divider" />

      <footer className="py-8 text-center">
        <p className="font-sans text-gray text-sm">© andrew zhou 2025-2026</p>
      </footer>
    </main>
  );
}
