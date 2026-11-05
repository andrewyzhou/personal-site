// render-time route smoothing. stored polylines and stats stay raw — these
// transforms only shape what gets drawn, so they can be tuned or reverted
// without touching data.

// midpoint quadratic smoothing for svg renderers: curves run through segment
// midpoints using the original points as bézier controls. tangent-continuous
// (no kinks at joints), single pass, and can never overshoot — each curve is
// bounded by its control triangle, so gps hairpins can't loop. the first and
// last points are preserved exactly. `decimals` controls serialization width
// (thumbs project into different coordinate scales).
export function quadraticPathD(pts: [number, number][], decimals: number): string {
  const f = (n: number) => n.toFixed(decimals);
  if (pts.length === 0) return "";
  if (pts.length === 1) return `M${f(pts[0][0])} ${f(pts[0][1])}`;
  if (pts.length === 2) return `M${f(pts[0][0])} ${f(pts[0][1])}L${f(pts[1][0])} ${f(pts[1][1])}`;

  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [cx, cy] = pts[i];
    const last = i === pts.length - 2;
    const ex = last ? pts[i + 1][0] : (pts[i][0] + pts[i + 1][0]) / 2;
    const ey = last ? pts[i + 1][1] : (pts[i][1] + pts[i + 1][1]) / 2;
    d += `Q${f(cx)} ${f(cy)} ${f(ex)} ${f(ey)}`;
  }
  return d;
}

// chaikin corner cutting for renderers that need vertices rather than curve
// commands (maplibre tessellates straight segments). each pass replaces every
// corner with points ¼ and ¾ along its adjoining segments; two passes
// approximate a quadratic b-spline at ~4× the points. endpoints are kept.
export function chaikin(pts: [number, number][], iterations = 2): [number, number][] {
  let out = pts;
  for (let k = 0; k < iterations; k++) {
    if (out.length < 3) return out;
    const next: [number, number][] = [out[0]];
    for (let i = 0; i < out.length - 1; i++) {
      const [ax, ay] = out[i];
      const [bx, by] = out[i + 1];
      next.push([0.75 * ax + 0.25 * bx, 0.75 * ay + 0.25 * by]);
      next.push([0.25 * ax + 0.75 * bx, 0.25 * ay + 0.75 * by]);
    }
    next.push(out[out.length - 1]);
    out = next;
  }
  return out;
}

// one svg path for a multi-segment route: each segment starts with its own M,
// so nothing is ever drawn between segments (fogged gaps stay gaps)
export function multiQuadraticPathD(segments: [number, number][][], decimals: number): string {
  return segments
    .filter((s) => s.length >= 2)
    .map((s) => quadraticPathD(s, decimals))
    .join("");
}

// equirectangular projection shared by the svg thumbnails: every point of
// every segment lands in one frame (so gaps keep their real size), y down,
// origin at the min corner
export interface ProjectedRoute {
  segments: [number, number][][];
  w: number;
  h: number;
}

export function projectSegments(segments: [number, number][][]): ProjectedRoute | null {
  if (!segments.some((s) => s.length >= 2)) return null;
  const all = segments.flat();
  const cos = Math.cos((all.reduce((s, p) => s + p[0], 0) / all.length) * (Math.PI / 180));
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [lat, lng] of all) {
    const x = lng * cos;
    const y = -lat;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return {
    segments: segments.map((s) => s.map(([lat, lng]): [number, number] => [lng * cos - minX, -lat - minY])),
    w: maxX - minX || 1e-6,
    h: maxY - minY || 1e-6,
  };
}

// start/end of a published route: first point of the first segment, last
// point of the last one. these are the trimmed/fogged endpoints — the real
// start or end may sit inside a privacy zone and is never in the data.
export function routeEndpoints(segments: [number, number][][]): { start: [number, number]; end: [number, number] } | null {
  const usable = segments.filter((s) => s.length > 0);
  if (!usable.length) return null;
  const last = usable[usable.length - 1];
  return { start: usable[0][0], end: last[last.length - 1] };
}
