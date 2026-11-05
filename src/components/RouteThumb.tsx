import { decodeMultiPolyline } from "@/lib/polyline";
import { multiQuadraticPathD, projectSegments, routeEndpoints } from "@/lib/route-smooth";

// zero-dependency inline svg route thumbnail. equirectangular projection is
// plenty at activity scale. inline svg themes via the css variable directly —
// it never passes through the theme-light <img> invert filter, so this is the
// correct mechanism here (static /icons/ files keep stroke="#EEEEEE").
// multi-segment polylines draw each segment on its own (gaps stay gaps).
// start (filled dot) and end (ring) markers sit on the published endpoints,
// shown once the thumbnail is big enough to read them.
export const THUMB_MARKER_MIN_HEIGHT = 48;

export default function RouteThumb({
  polyline,
  height = 80,
  strokeWidth = 1.5,
  className,
  markers,
}: {
  polyline: string;
  height?: number;
  strokeWidth?: number;
  className?: string;
  markers?: boolean;
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
  const shifted = proj.segments.map((s) => s.map(([x, y]): [number, number] => [x + pad, y + pad]));

  // midpoint quadratic smoothing: gps points land ~20m apart (smart
  // recording), so straight chords read jagged at thumbnail scale
  const d = multiQuadraticPathD(shifted, 6);
  const vw = w + 2 * pad;
  const vh = h + 2 * pad;
  const showMarkers = markers ?? height >= THUMB_MARKER_MIN_HEIGHT;
  const ends = showMarkers ? routeEndpoints(shifted) : null;
  // ~3px at the rendered height (viewbox units per px = vh / height)
  const r = (3 * vh) / height;

  return (
    <svg
      viewBox={`0 0 ${vw.toFixed(6)} ${vh.toFixed(6)}`}
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
      {ends && (
        <>
          <circle
            data-marker="end"
            cx={ends.end[0]}
            cy={ends.end[1]}
            r={r}
            fill="var(--theme-bg)"
            stroke="var(--theme-text-primary)"
            strokeWidth={strokeWidth}
            vectorEffect="non-scaling-stroke"
          />
          <circle data-marker="start" cx={ends.start[0]} cy={ends.start[1]} r={r} fill="var(--theme-text-primary)" />
        </>
      )}
    </svg>
  );
}
