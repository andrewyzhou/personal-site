"use client";

import Image from "next/image";
import Link from "next/link";
import type { Photo } from "@/lib/photos";

interface Props {
  slug: string;
  title: string;
  cover: Photo;
  sizes: string;
  /** when true, fills the parent (must be sized) and crops to cover. */
  fill?: boolean;
}

export default function PhotosetCover({ slug, title, cover, sizes, fill = false }: Props) {
  return (
    <Link
      href={`/photos/${slug}`}
      aria-label={title}
      className="photoset-cover-link relative block overflow-hidden rounded"
      style={fill ? { width: "100%", height: "100%" } : undefined}
    >
      {fill ? (
        <Image
          src={cover.src}
          alt={title}
          fill
          sizes={sizes}
          className="object-cover"
        />
      ) : (
        <Image
          src={cover.src}
          alt={title}
          width={cover.width}
          height={cover.height}
          sizes={sizes}
          className="w-full h-auto"
        />
      )}
      <div className="photoset-cover-overlay" aria-hidden />
      <div className="photoset-cover-caption" aria-hidden>
        <span className="font-sans text-off-white text-base">{title}</span>
      </div>
    </Link>
  );
}
