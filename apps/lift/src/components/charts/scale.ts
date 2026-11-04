// chart geometry, kept pure so it's testable without react-native-svg.

export interface ChartPoint {
  x: number;
  y: number;
}

export interface Box {
  width: number;
  height: number;
  padLeft: number;
  padRight: number;
  padTop: number;
  padBottom: number;
}

export interface Scaled {
  points: ChartPoint[];
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

function linear(v: number, d0: number, d1: number, r0: number, r1: number): number {
  // a flat domain (one point, or all equal) sits in the middle
  if (d1 === d0) return (r0 + r1) / 2;
  return r0 + ((v - d0) / (d1 - d0)) * (r1 - r0);
}

/** maps data to pixel space (y grows downward); drops non-finite values */
export function scalePoints(data: readonly ChartPoint[], box: Box): Scaled | null {
  const pts = data.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (pts.length === 0) return null;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const left = box.padLeft;
  const right = box.width - box.padRight;
  const top = box.padTop;
  const bottom = box.height - box.padBottom;
  return {
    minX,
    maxX,
    minY,
    maxY,
    points: pts.map((p) => ({
      x: linear(p.x, minX, maxX, left, right),
      y: linear(p.y, minY, maxY, bottom, top),
    })),
  };
}

export function polylinePoints(points: readonly ChartPoint[]): string {
  return points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
}
