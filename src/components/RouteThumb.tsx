import { decodeMultiPolyline } from "@/lib/polyline";
import { multiQuadraticPathD, projectSegments } from "@/lib/route-smooth";

// zero-dependency inline svg route thumbnail. equirectangular projection is
// plenty at activity scale. inline svg themes via the css variable directly —
// it never passes through the theme-light <img> invert filter, so this is the
// correct mechanism here (static /icons/ files keep stroke="#EEEEEE").
// multi-segment polylines draw each segment on its own (gaps stay gaps).
export default function RouteThumb({
  polyline,
  height = 80,
  strokeWidth = 1.5,
  className,
}: {
  polyline: string;
  height?: number;
  strokeWidth?: number;
  className?: string;
}) {
  let segments: [number, number][][];
  try {
    segments = decodeMultiPolyline(polyline);
  } catch {
    return null;
  }
  const proj = projectSegments(segments);
  if (!proj) return null;
  const { w, h } = proj;
  const pad = Math.max(w, h) * 0.05;

  // midpoint quadratic smoothing: gps points land ~20m apart (smart
  // recording), so straight chords read jagged at thumbnail scale
  const d = multiQuadraticPathD(
    proj.segments.map((s) => s.map(([x, y]): [number, number] => [x + pad, y + pad])),
    6
  );

  return (
    <svg
      viewBox={`0 0 ${(w + 2 * pad).toFixed(6)} ${(h + 2 * pad).toFixed(6)}`}
      style={{ height, maxWidth: "100%" }}
      preserveAspectRatio="xMidYMid meet"
      className={className}
      role="img"
      aria-label="route map"
    >
      <path
        d={d}
        fill="none"
        stroke="var(--theme-text-primary)"
        strokeWidth={strokeWidth}
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
        strokeLinecap="round"
        opacity={0.9}
      />
    </svg>
  );
}
