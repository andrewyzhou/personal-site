"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ProgressBar from "./ProgressBar";
import MetaSidebar from "./MetaSidebar";
import { flattenBlocks, hasSidebarContent, hasTextContent } from "@/lib/essay-steps";
import type { EssayBlock } from "@/lib/photos";

const TICK_MS = 50;

function formatDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  const month = d.toLocaleDateString("en-US", { month: "short" }).toLowerCase();
  return `${month} ${d.getDate()}, ${d.getFullYear()}`;
}

interface Props {
  slug: string;
  title: string;
  date: string;
  caption: string;
  blocks: EssayBlock[];
  prevSlug: string | null;
  nextSlug: string | null;
}

// block-format essay viewer: image | gallery | text steps. captions render
// below the frame so the stage never reflows with text length; the info
// sidebar shows exif + location for the current image.
export default function EssayViewer({ slug, title, date, caption, blocks, prevSlug, nextSlug }: Props) {
  const router = useRouter();
  const steps = flattenBlocks(blocks);
  const total = steps.length;
  const startPaused = hasTextContent(blocks);

  const [index, setIndex] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [paused, setPaused] = useState(startPaused);
  const [showInfo, setShowInfo] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const hoverRef = useRef(false);

  const step = steps[Math.min(index, total - 1)];

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // reset on slug change
  useEffect(() => {
    setIndex(0);
    setElapsed(0);
    setPaused(startPaused);
    setShowInfo(false);
  }, [slug, startPaused]);

  const goTo = useCallback(
    (next: number) => {
      setIndex(Math.max(0, Math.min(next, total - 1)));
      setElapsed(0);
    },
    [total]
  );

  // auto-advance ticker (skips while paused/hovered/hidden)
  useEffect(() => {
    if (total <= 1) return;
    const interval = setInterval(() => {
      if (paused || hoverRef.current || document.visibilityState !== "visible") return;
      setElapsed((e) => {
        if (e + TICK_MS >= step.durationMs) {
          setIndex((i) => (i + 1 < total ? i + 1 : i));
          return 0;
        }
        return e + TICK_MS;
      });
    }, TICK_MS);
    return () => clearInterval(interval);
  }, [paused, total, step.durationMs]);

  // keyboard controls
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") goTo(index + 1);
      else if (e.key === "ArrowLeft") goTo(index - 1);
      else if (e.key === "ArrowUp" && prevSlug) router.push(`/photos/${prevSlug}`);
      else if (e.key === "ArrowDown" && nextSlug) router.push(`/photos/${nextSlug}`);
      else if (e.key === " ") {
        e.preventDefault();
        setPaused((p) => !p);
      } else if (e.key === "i" && step.type === "image" && hasSidebarContent(step.image)) {
        setShowInfo((s) => !s);
      } else if (e.key === "Escape") router.push("/photos");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goTo, index, prevSlug, nextSlug, router, step]);

  const infoAvailable = step.type === "image" && hasSidebarContent(step.image);

  return (
    <div
      onMouseEnter={() => (hoverRef.current = true)}
      onMouseLeave={() => (hoverRef.current = false)}
      style={{ maxWidth: "900px", margin: "0 auto" }}
    >
      {/* stage */}
      <div style={{ position: "relative" }}>
        {step.type === "image" && step.image ? (
          <div className="flex items-center justify-center" style={{ minHeight: "40vh" }}>
            <Image
              src={step.image.src}
              alt={step.image.alt}
              width={step.image.width}
              height={step.image.height}
              className="rounded-lg"
              style={{ maxHeight: "75vh", width: "auto", height: "auto", maxWidth: "100%" }}
              priority={index === 0}
            />
          </div>
        ) : (
          <div className="flex items-center justify-center" style={{ minHeight: "40vh", padding: "2rem" }}>
            <p className="font-sans text-secondary text-lg leading-[1.6]" style={{ maxWidth: "42rem", whiteSpace: "pre-wrap" }}>
              {step.body}
            </p>
          </div>
        )}

        {/* nav buttons */}
        {total > 1 && (
          <>
            <button onClick={() => goTo(index - 1)} disabled={index === 0} className="photoset-nav-btn left-2" aria-label="previous">
              ←
            </button>
            <button onClick={() => goTo(index + 1)} disabled={index === total - 1} className="photoset-nav-btn right-2" aria-label="next">
              →
            </button>
          </>
        )}

        {showInfo && step.type === "image" && step.image && (
          <MetaSidebar image={step.image} onClose={() => setShowInfo(false)} mobile={isMobile} />
        )}
      </div>

      {/* caption below the frame — the stage never reflows with text length */}
      {step.type === "image" && step.image && (step.image.caption || step.image.text || step.galleryPosition) && (
        <div style={{ marginTop: "0.75rem" }}>
          {step.image.caption && (
            <p className="font-sans text-secondary text-base">
              {step.image.caption}
              {step.galleryPosition && (
                <span className="text-gray text-xs"> · {step.galleryPosition.index + 1}/{step.galleryPosition.count}</span>
              )}
            </p>
          )}
          {!step.image.caption && step.galleryPosition && (
            <p className="font-sans text-gray text-xs">{step.galleryPosition.index + 1}/{step.galleryPosition.count}</p>
          )}
          {step.image.text && (
            <p className="font-sans text-gray text-base leading-[1.45]" style={{ maxWidth: "42rem", marginTop: "0.25rem" }}>
              {step.image.text}
            </p>
          )}
        </div>
      )}

      {/* progress */}
      {total > 1 && (
        <div style={{ marginTop: "1rem" }}>
          <ProgressBar total={total} currentIndex={index} currentFill={paused ? 0 : elapsed / step.durationMs} />
        </div>
      )}

      {/* set caption + date */}
      <div className="text-center" style={{ marginTop: "1rem" }}>
        {caption && <p className="font-sans text-secondary text-base italic">{caption}</p>}
        <p className="font-sans text-gray text-sm" style={{ marginTop: "0.25rem" }}>
          {formatDate(date)}
        </p>
      </div>

      {/* controls row */}
      <div className="flex items-center justify-between" style={{ marginTop: "1.5rem" }}>
        <Link href="/photos" className="font-sans text-base text-off-white link-highlight">
          ← back to photos
        </Link>
        <div className="flex items-center" style={{ gap: "12px" }}>
          {infoAvailable && (
            <button
              onClick={() => setShowInfo((s) => !s)}
              className={`font-sans text-base ${showInfo ? "text-off-white link-highlight-active" : "text-off-white link-highlight"}`}
            >
              info
            </button>
          )}
          {prevSlug && (
            <Link href={`/photos/${prevSlug}`} className="font-sans text-base text-off-white link-highlight">
              ↑ previous set
            </Link>
          )}
          {nextSlug && (
            <Link href={`/photos/${nextSlug}`} className="font-sans text-base text-off-white link-highlight">
              ↓ next set
            </Link>
          )}
        </div>
      </div>

      <p className="font-sans text-gray text-xs italic text-center" style={{ marginTop: "1rem" }}>
        ← → steps · ↑ ↓ sets · space pause{infoAvailable ? " · i info" : ""} · esc back{paused ? " · paused" : ""}
      </p>

      <p className="sr-only" aria-live="polite">
        step {index + 1} of {total}: {title}
      </p>
    </div>
  );
}
