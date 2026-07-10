import { decodePolyline } from "@/lib/polyline";
import { quadraticPathD } from "@/lib/route-smooth";

// zero-dependency inline svg route thumbnail. equirectangular projection is
// plenty at activity scale. inline svg themes via the css variable directly —
// it never passes through the theme-light <img> invert filter, so this is the
// correct mechanism here (static /icons/ files keep stroke="#EEEEEE").
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
  const pts = decodePolyline(polyline);
  if (pts.length < 2) return null;

  const midLat = (pts.reduce((s, p) => s + p[0], 0) / pts.length) * (Math.PI / 180);
  const cos = Math.cos(midLat);
  const xs = pts.map(([, lng]) => lng * cos);
  const ys = pts.map(([lat]) => -lat);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const w = maxX - minX || 1e-6;
  const h = maxY - minY || 1e-6;
  const pad = Math.max(w, h) * 0.05;

  // midpoint quadratic smoothing: gps points land ~20m apart (smart
  // recording), so straight chords read jagged at thumbnail scale
  const d = quadraticPathD(
    pts.map((_, i): [number, number] => [xs[i] - minX + pad, ys[i] - minY + pad]),
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
