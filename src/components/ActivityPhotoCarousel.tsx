"use client";

import { useRef } from "react";

interface Photo {
  url: string;
  width: number | null;
  height: number | null;
  caption: string | null;
}

// horizontal snap carousel of activity photos. plain <img> by design: photos
// are pre-downscaled (≤2000px, ~400kb), so bypassing next/image protects the
// image-optimization quota and needs no remotePatterns config.
export default function ActivityPhotoCarousel({ photos }: { photos: Photo[] }) {
  const scrollerRef = useRef<HTMLDivElement>(null);

  if (photos.length === 0) return null;

  const scrollBy = (dir: -1 | 1) => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: "smooth" });
  };

  return (
    <div style={{ position: "relative", margin: "2rem 0" }}>
      <div
        ref={scrollerRef}
        style={{
          display: "flex",
          gap: "0.75rem",
          overflowX: "auto",
          scrollSnapType: "x mandatory",
          WebkitOverflowScrolling: "touch",
        }}
      >
        {photos.map((p, i) => (
          // eslint-disable-next-line @next/next/no-img-element -- pre-downscaled photos bypass image optimization by design (quota protection)
          <img
            key={i}
            src={p.url}
            alt={p.caption ?? `activity photo ${i + 1}`}
            loading="lazy"
            className="rounded-lg"
            style={{
              scrollSnapAlign: "start",
              maxHeight: "420px",
              maxWidth: photos.length === 1 ? "100%" : "85%",
              objectFit: "contain",
              flexShrink: 0,
            }}
          />
        ))}
      </div>
      {photos.length > 1 && (
        <>
          <button
            onClick={() => scrollBy(-1)}
            className="photoset-nav-btn"
            aria-label="previous photo"
            style={{ position: "absolute", left: "0.5rem", top: "50%", transform: "translateY(-50%)" }}
          >
            ←
          </button>
          <button
            onClick={() => scrollBy(1)}
            className="photoset-nav-btn"
            aria-label="next photo"
            style={{ position: "absolute", right: "0.5rem", top: "50%", transform: "translateY(-50%)" }}
          >
            →
          </button>
        </>
      )}
    </div>
  );
}
