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
