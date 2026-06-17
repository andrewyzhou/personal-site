import Link from "next/link";
import type { Metadata } from "next";
import { getAllPhotosets } from "@/lib/photos";
import JustifiedLayout from "@/components/photos/JustifiedLayout";

export const metadata: Metadata = {
  title: "photos · andrew zhou",
  description: "photos i've taken.",
};

export default function PhotosPage() {
  const sets = getAllPhotosets();

  return (
    <main className="site-container">
      <section className="py-8">
        <Link href="/" className="font-sans text-gray text-base link-highlight">
          ← home
        </Link>
      </section>

      <section className="py-8">
        <h1 className="font-sans font-bold text-off-white text-6xl" style={{ letterSpacing: "-0.02em", marginBottom: "1rem" }}>
          photos
        </h1>
        <p className="font-sans text-gray text-lg leading-[1.35] max-w-2xl">
          photos i&apos;ve taken when i remember to bring a camera — film, phone, whatever. click into a set for the full thing.
        </p>
      </section>

      <div className="section-divider" />

      <section className="py-8">
        {sets.length === 0 ? (
          <p className="font-sans text-gray text-lg italic">no photos yet.</p>
        ) : (
          <JustifiedLayout sets={sets} />
        )}
      </section>

      <div className="section-divider" />

      <footer className="py-8 text-center">
        <p className="font-sans text-gray text-sm">© andrew zhou 2025-2026</p>
      </footer>
    </main>
  );
}
