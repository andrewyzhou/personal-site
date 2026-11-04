import { decodeMultiPolyline } from "@/lib/polyline";
import { multiQuadraticPathD, projectSegments } from "@/lib/route-smooth";

// self-contained svg route rendered as a data uri, for places that need the
// route as an *image url* (css backgrounds, <img> src) rather than a react
// element — the RouteThumb component stays the right tool for inline svg.
// projection math intentionally mirrors RouteThumb; standalone images cannot
// use css variables, so the stroke is the icon-set #EEEEEE and light theme
// inverts via the .route-uri-thumb css class. multi-segment polylines draw
// each segment on its own (never a line across a fogged gap).
export function routeThumbDataUri(polyline: string): string | null {
  let segments: [number, number][][];
  try {
    segments = decodeMultiPolyline(polyline);
  } catch {
    return null;
  }
  const proj = projectSegments(segments);
  if (!proj) return null;
  const { w, h } = proj;
  const pad = Math.max(w, h) * 0.08;

  // rescale to a ~100-unit viewbox so coordinates serialize short (2 decimals)
  // and the data uri stays a few kb for a 100-point card polyline. midpoint
  // quadratic smoothing rounds the ~20m-apart gps corners at thumbnail scale.
  const scale = 100 / Math.max(w, h);
  const d = multiQuadraticPathD(
    proj.segments.map((s) => s.map(([x, y]): [number, number] => [(x + pad) * scale, (y + pad) * scale])),
    2
  );

  const vw = ((w + 2 * pad) * scale).toFixed(2);
  const vh = ((h + 2 * pad) * scale).toFixed(2);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vw} ${vh}"><path d="${d}" fill="none" stroke="#EEEEEE" stroke-width="1.5" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round" opacity="0.9"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
