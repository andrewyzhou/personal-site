import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getAllGalleries, getGalleryBySlug, getAdjacentGalleries } from "@/lib/gallery";
import GalleryViewer from "@/components/gallery/GalleryViewer";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
  return getAllGalleries().map((g) => ({ slug: g.slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const g = getGalleryBySlug(slug);
  if (!g) return { title: "not found · andrew zhou" };
  return {
    title: `${g.title} · gallery · andrew zhou`,
    description: g.caption,
  };
}

export default async function GalleryDetailPage({ params }: PageProps) {
  const { slug } = await params;
  const gallery = getGalleryBySlug(slug);
  if (!gallery) notFound();

  // adjacency: prev = newer (gallery list is newest-first, so the previous
  // index in the list is more recent). matches the keyboard semantics where
  // ↑ goes to the previous (more recent) gallery and ↓ goes to the next.
  const { prev, next } = getAdjacentGalleries(slug);

  return (
    <main className="site-container">
      <section className="py-8">
        <Link href="/gallery" className="font-sans text-gray text-base link-highlight">
          ← gallery
        </Link>
      </section>

      <section className="py-4">
        <h1
          className="font-sans font-bold text-off-white text-4xl"
          style={{ letterSpacing: "-0.01em", marginBottom: "1.5rem" }}
        >
          {gallery.title}
        </h1>

        <GalleryViewer
          slug={gallery.slug}
          title={gallery.title}
          date={gallery.date}
          caption={gallery.caption}
          photos={gallery.photos}
          prevSlug={prev?.slug ?? null}
          nextSlug={next?.slug ?? null}
        />
      </section>

      <div className="section-divider" />

      <footer className="py-8 text-center">
        <p className="font-sans text-gray text-sm">© andrew zhou 2025-2026</p>
      </footer>
    </main>
  );
}
