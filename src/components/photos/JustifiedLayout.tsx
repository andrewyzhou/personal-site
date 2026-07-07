"use client";

import { useEffect, useRef, useState } from "react";
import type { Photo } from "@/lib/photos";

// only the fields the cover grid consumes — accepts flat sets and essays alike
interface CoverSet {
  slug: string;
  title: string;
  cover: Photo;
}
import PhotosetCover from "./PhotosetCover";

interface Props {
  sets: CoverSet[];
}

const TARGET_ROW_HEIGHT_DESKTOP = 260;
const TARGET_ROW_HEIGHT_MOBILE = 180;
const GAP = 8;
const MIN_PER_ROW = 2;
const MAX_PER_ROW = 4;
const MAX_SCALE = 1.5; // allow scaling rows up to fit container when needed

interface Row {
  sets: CoverSet[];
  height: number;
}

// flickr-style justified rows: greedy pack covers into rows of 2-4 photos,
// scale each row to fill container width exactly.
function packRows(
  sets: CoverSet[],
  containerWidth: number,
  targetHeight: number
): Row[] {
  if (containerWidth <= 0 || sets.length === 0) return [];
  const rows: Row[] = [];
  let current: CoverSet[] = [];
  let currentWidthAtTarget = 0;

  const availableWidth = containerWidth;

  const flushRow = (rowSets: CoverSet[], widthAtTarget: number, isLast: boolean) => {
    if (rowSets.length === 0) return;
    const totalGap = (rowSets.length - 1) * GAP;
    const usableWidth = availableWidth - totalGap;
    const rawScale = usableWidth / widthAtTarget;
    // for the trailing partial row, cap upscale so a single photo doesn't blow up
    const scale = isLast ? Math.min(rawScale, MAX_SCALE) : rawScale;
    const rowHeight = targetHeight * scale;
    rows.push({ sets: rowSets, height: rowHeight });
  };

  for (const s of sets) {
    const aspect = s.cover.height > 0 ? s.cover.width / s.cover.height : 1;
    const widthAtTarget = targetHeight * aspect;
    current.push(s);
    currentWidthAtTarget += widthAtTarget;

    const wouldOverflow = currentWidthAtTarget > availableWidth - (current.length - 1) * GAP;
    const atMax = current.length >= MAX_PER_ROW;
    if ((wouldOverflow && current.length >= MIN_PER_ROW) || atMax) {
      flushRow(current, currentWidthAtTarget, false);
      current = [];
      currentWidthAtTarget = 0;
    }
  }
  if (current.length > 0) {
    flushRow(current, currentWidthAtTarget, true);
  }
  return rows;
}

export default function JustifiedLayout({ sets }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [targetHeight, setTargetHeight] = useState(TARGET_ROW_HEIGHT_DESKTOP);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const compute = () => {
      setContainerWidth(el.clientWidth);
      setTargetHeight(window.innerWidth < 640 ? TARGET_ROW_HEIGHT_MOBILE : TARGET_ROW_HEIGHT_DESKTOP);
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    window.addEventListener("resize", compute);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", compute);
    };
  }, []);

  const rows = packRows(sets, containerWidth, targetHeight);

  return (
    <div ref={containerRef} className="w-full">
      {containerWidth === 0 ? (
        // pre-measure render: hidden placeholder to avoid layout shift flash
        <div style={{ minHeight: "60vh" }} />
      ) : (
        rows.map((row, i) => (
          <div
            key={i}
            className="flex"
            style={{ gap: `${GAP}px`, marginBottom: `${GAP}px`, height: `${row.height}px` }}
          >
            {row.sets.map((s) => {
              const aspect = s.cover.height > 0 ? s.cover.width / s.cover.height : 1;
              const width = row.height * aspect;
              return (
                <div key={s.slug} className="relative" style={{ width: `${width}px`, height: "100%" }}>
                  <PhotosetCover
                    slug={s.slug}
                    title={s.title}
                    cover={s.cover}
                    sizes={`${Math.ceil(width)}px`}
                    fill
                  />
                </div>
              );
            })}
          </div>
        ))
      )}
    </div>
  );
}
