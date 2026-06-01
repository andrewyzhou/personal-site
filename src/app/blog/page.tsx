import Link from "next/link";
import type { Metadata } from "next";
import { getAllPosts, getAllTags } from "@/lib/blog";
import BlogIndex from "@/components/blog/BlogIndex";

export const metadata: Metadata = {
  title: "blog · andrew zhou",
  description: "writing, photos, and notes on things i'm thinking about.",
};

export default function BlogPage() {
  const posts = getAllPosts();
  const allTags = getAllTags();

  return (
    <main className="site-container">
      <section className="py-8">
        <Link href="/" className="font-sans text-gray text-base link-highlight">
          ← home
        </Link>
      </section>

      <section className="py-8">
        <h1 className="font-sans font-bold text-off-white text-6xl" style={{ letterSpacing: "-0.02em", marginBottom: "1rem" }}>
          blog
        </h1>
        <p className="font-sans text-gray text-lg leading-[1.35] max-w-2xl">
          writing, photos, and half-formed thoughts — on whatever i&apos;ve been making, reading, or wandering into lately.
        </p>
      </section>

      <div className="section-divider" />

      <section className="py-8">
        <BlogIndex posts={posts} allTags={allTags} />
      </section>

      <div className="section-divider" />

      <footer className="py-8 text-center">
        <p className="font-sans text-gray text-sm">© andrew zhou 2025-2026</p>
      </footer>
    </main>
  );
}
