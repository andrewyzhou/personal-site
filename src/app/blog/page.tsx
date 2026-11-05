import Link from "next/link";
import type { Metadata } from "next";
import { getAllPosts, getAllTags } from "@/lib/blog";
import BlogIndex from "@/components/blog/BlogIndex";
import { getSite, pageTitle } from "@/content/site";

const site = getSite();

export const metadata: Metadata = {
  title: pageTitle(site, site.pages.blog.title),
  description: site.pages.blog.metaDescription,
};

export default function BlogPage() {
  const posts = getAllPosts();
  const allTags = getAllTags();

  return (
    <main className="site-container">
      <section className="py-8">
        <Link href="/" className="font-sans text-gray text-base link-highlight">
          {`← ${site.nav.home}`}
        </Link>
      </section>

      <section className="py-8">
        <h1 className="font-sans font-bold text-off-white text-6xl" style={{ letterSpacing: "-0.02em", marginBottom: "1rem" }}>
          {site.pages.blog.title}
        </h1>
        <p className="font-sans text-gray text-lg leading-[1.35] max-w-2xl">
          {site.pages.blog.intro}
        </p>
      </section>

      <div className="section-divider" />

      <section className="py-8">
        <BlogIndex posts={posts} allTags={allTags} />
      </section>

      <div className="section-divider" />

      <footer className="py-8 text-center">
        <p className="font-sans text-gray text-sm">{site.site.footer}</p>
      </footer>
    </main>
  );
}
