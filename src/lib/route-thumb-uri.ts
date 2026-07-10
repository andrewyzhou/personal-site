import { decodePolyline } from "@/lib/polyline";

// self-contained svg route rendered as a data uri, for places that need the
// route as an *image url* (css backgrounds, <img> src) rather than a react
// element — the RouteThumb component stays the right tool for inline svg.
// projection math intentionally mirrors RouteThumb; standalone images cannot
// use css variables, so the stroke is the icon-set #EEEEEE and light theme
// inverts via the .route-uri-thumb css class.
export function routeThumbDataUri(polyline: string): string | null {
  let pts: [number, number][];
  try {
    pts = decodePolyline(polyline);
  } catch {
    return null;
  }
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
  const pad = Math.max(w, h) * 0.08;

  // rescale to a ~100-unit viewbox so coordinates serialize short (2 decimals)
  // and the data uri stays ~1kb for a 100-point card polyline
  const scale = 100 / Math.max(w, h);
  const d = pts
    .map((_, i) => {
      const x = ((xs[i] - minX + pad) * scale).toFixed(2);
      const y = ((ys[i] - minY + pad) * scale).toFixed(2);
      return `${i === 0 ? "M" : "L"}${x} ${y}`;
    })
    .join("");

  const vw = ((w + 2 * pad) * scale).toFixed(2);
  const vh = ((h + 2 * pad) * scale).toFixed(2);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vw} ${vh}"><path d="${d}" fill="none" stroke="#EEEEEE" stroke-width="1.5" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round" opacity="0.9"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
