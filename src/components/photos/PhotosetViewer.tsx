"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Photo } from "@/lib/photos";
import ProgressBar from "./ProgressBar";

interface Props {
  slug: string;
  title: string;
  date: string;
  caption: string;
  photos: Photo[];
  prevSlug: string | null;
  nextSlug: string | null;
}

const AUTO_ADVANCE_MS = 5000;
const TICK_MS = 50;

function formatDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  const month = d.toLocaleDateString("en-US", { month: "short" }).toLowerCase();
  return `${month} ${d.getDate()}, ${d.getFullYear()}`;
}

export default function PhotosetViewer({
  slug,
  title,
  date,
  caption,
  photos,
  prevSlug,
  nextSlug,
}: Props) {
  const router = useRouter();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [elapsed, setElapsed] = useState(0); // ms within current photo
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hoverRef = useRef(false);

  const total = photos.length;

  const goTo = useCallback(
    (next: number) => {
      const safe = ((next % total) + total) % total;
      setIndex(safe);
      setElapsed(0);
    },
    [total]
  );

  const goNext = useCallback(() => goTo(index + 1), [goTo, index]);
  const goPrev = useCallback(() => goTo(index - 1), [goTo, index]);

  // auto-advance ticker
  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (paused || total <= 1) return;
    intervalRef.current = setInterval(() => {
      if (hoverRef.current || document.visibilityState !== "visible") return;
      setElapsed((e) => {
        if (e + TICK_MS >= AUTO_ADVANCE_MS) {
          setIndex((i) => (i + 1) % total);
          return 0;
        }
        return e + TICK_MS;
      });
    }, TICK_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [paused, total]);

  // keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") {
        e.preventDefault();
        goNext();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPrev();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        if (nextSlug) router.push(`/photos/${nextSlug}`);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (prevSlug) router.push(`/photos/${prevSlug}`);
      } else if (e.key === "Escape") {
        e.preventDefault();
        router.push("/photos");
      } else if (e.key === " ") {
        e.preventDefault();
        setPaused((p) => !p);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goNext, goPrev, nextSlug, prevSlug, router]);

  // reset on slug change (when nav crosses sets)
  useEffect(() => {
    setIndex(0);
    setElapsed(0);
    setPaused(false);
  }, [slug]);

  const current = photos[index];
  const currentFill = total > 1 && !paused ? elapsed / AUTO_ADVANCE_MS : index < total - 1 ? 0 : 0;

  return (
    <div
      className="flex flex-col items-center w-full"
      onMouseEnter={() => (hoverRef.current = true)}
      onMouseLeave={() => (hoverRef.current = false)}
    >
      {/* image stage */}
      <div className="relative w-full flex justify-center items-center" style={{ minHeight: "60vh" }}>
        {/* prev button (left side) */}
        {total > 1 && (
          <button
            aria-label="previous photo"
            onClick={goPrev}
            className="photoset-nav-btn left-2"
          >
            <span aria-hidden>‹</span>
          </button>
        )}

        <div className="relative" style={{ maxWidth: "100%", maxHeight: "75vh" }}>
          <Image
            src={current.src}
            alt={`${title} ${index + 1}`}
            width={current.width}
            height={current.height}
            priority
            sizes="(min-width: 1024px) 75vw, 100vw"
            style={{ maxHeight: "75vh", width: "auto", height: "auto", objectFit: "contain" }}
          />
          {/* preload next photo */}
          {total > 1 && (
            <Image
              src={photos[(index + 1) % total].src}
              alt=""
              width={1}
              height={1}
              aria-hidden
              style={{ position: "absolute", opacity: 0, pointerEvents: "none", width: 1, height: 1 }}
            />
          )}
        </div>

        {/* next button (right side) */}
        {total > 1 && (
          <button
            aria-label="next photo"
            onClick={goNext}
            className="photoset-nav-btn right-2"
          >
            <span aria-hidden>›</span>
          </button>
        )}
      </div>

      {/* progress bar */}
      <div className="w-full" style={{ maxWidth: "900px", marginTop: "1rem" }}>
        <ProgressBar total={total} currentIndex={index} currentFill={currentFill} />
      </div>

      {/* caption + date */}
      <div className="w-full text-center" style={{ maxWidth: "900px", marginTop: "1rem" }}>
        <p className="font-sans text-secondary text-base italic leading-[1.45]">{caption}</p>
        <p className="font-sans text-gray text-sm" style={{ marginTop: "0.25rem" }}>
          {formatDate(date)}
        </p>
      </div>

      {/* controls row */}
      <div className="w-full flex justify-between items-center flex-wrap gap-3" style={{ maxWidth: "900px", marginTop: "1.5rem" }}>
        <Link href="/photos" className="font-sans text-gray text-base link-highlight">
          ← back to photos
        </Link>

        <div className="flex gap-3">
          <button
            onClick={() => prevSlug && router.push(`/photos/${prevSlug}`)}
            disabled={!prevSlug}
            className={`font-sans text-base ${prevSlug ? "text-off-white link-highlight" : "text-gray opacity-40 cursor-not-allowed"}`}
          >
            ↑ previous set
          </button>
          <button
            onClick={() => nextSlug && router.push(`/photos/${nextSlug}`)}
            disabled={!nextSlug}
            className={`font-sans text-base ${nextSlug ? "text-off-white link-highlight" : "text-gray opacity-40 cursor-not-allowed"}`}
          >
            ↓ next set
          </button>
        </div>
      </div>

      {/* keyboard hint */}
      <p className="font-sans text-gray text-xs italic" style={{ marginTop: "1rem" }}>
        ← → photos · ↑ ↓ sets · space pause · esc back {paused ? "· paused" : ""}
      </p>
    </div>
  );
}
