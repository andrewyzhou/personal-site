import Link from "next/link";
import type { Metadata } from "next";
import { getAllPhotosets } from "@/lib/photos";
import JustifiedLayout from "@/components/photos/JustifiedLayout";
import { getSite, pageTitle } from "@/content/site";

const site = getSite();

export const metadata: Metadata = {
  title: pageTitle(site, site.pages.photos.title),
  description: site.pages.photos.metaDescription,
};

export default function PhotosPage() {
  const sets = getAllPhotosets();

  return (
    <main className="site-container">
      <section className="py-8">
        <Link href="/" className="font-sans text-gray text-base link-highlight">
          {`← ${site.nav.home}`}
        </Link>
      </section>

      <section className="py-8">
        <h1 className="font-sans font-bold text-off-white text-6xl" style={{ letterSpacing: "-0.02em", marginBottom: "1rem" }}>
          {site.pages.photos.title}
        </h1>
        <p className="font-sans text-gray text-lg leading-[1.35] max-w-2xl">
          {site.pages.photos.intro}
        </p>
      </section>

      <div className="section-divider" />

      <section className="py-8">
        {sets.length === 0 ? (
          <p className="font-sans text-gray text-lg italic">{site.pages.photos.empty}</p>
        ) : (
          <JustifiedLayout sets={sets} />
        )}
      </section>

      <div className="section-divider" />

      <footer className="py-8 text-center">
        <p className="font-sans text-gray text-sm">{site.site.footer}</p>
      </footer>
    </main>
  );
}
