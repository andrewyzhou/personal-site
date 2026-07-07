import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getAllPhotosets, getPhotosetBySlug, getAdjacentPhotosets } from "@/lib/photos";
import PhotosetViewer from "@/components/photos/PhotosetViewer";
import EngagementSection from "@/components/EngagementSection";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
  return getAllPhotosets().map((s) => ({ slug: s.slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const set = getPhotosetBySlug(slug);
  if (!set) return { title: "not found · andrew zhou" };
  return {
    title: `${set.title} · photos · andrew zhou`,
    description: set.caption,
  };
}

export default async function PhotosetDetailPage({ params }: PageProps) {
  const { slug } = await params;
  const set = getPhotosetBySlug(slug);
  if (!set) notFound();

  // adjacency: prev = newer (the list is newest-first, so the previous index
  // is more recent). matches the keyboard semantics where ↑ goes to the
  // previous (more recent) set and ↓ goes to the next.
  const { prev, next } = getAdjacentPhotosets(slug);

  return (
    <main className="site-container">
      <section className="py-8">
        <Link href="/photos" className="font-sans text-gray text-base link-highlight">
          ← photos
        </Link>
      </section>

      <section className="py-4">
        <h1
          className="font-sans font-bold text-off-white text-4xl"
          style={{ letterSpacing: "-0.01em", marginBottom: "1.5rem" }}
        >
          {set.title}
        </h1>

        <PhotosetViewer
          slug={set.slug}
          title={set.title}
          date={set.date}
          caption={set.caption}
          photos={set.photos}
          prevSlug={prev?.slug ?? null}
          nextSlug={next?.slug ?? null}
        />

        <div style={{ maxWidth: "720px", margin: "0 auto" }}>
          <EngagementSection target={`photos:${set.slug}`} />
        </div>
      </section>

      <div className="section-divider" />

      <footer className="py-8 text-center">
        <p className="font-sans text-gray text-sm">© andrew zhou 2025-2026</p>
      </footer>
    </main>
  );
}
