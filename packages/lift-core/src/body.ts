import type { MuscleRegion } from "./types";

// original body-figure art shared by the site (dom svg) and the phone
// (react-native-svg): plain path data, no renderer assumptions.

export type BodyView = "front" | "back";

export interface BodyShape {
  /** svg path data in the figure's viewBox */
  d: string;
  /** muscle region this shape lights up; null = outline/non-muscle (head, hands, joints) */
  region: MuscleRegion | null;
}

export interface BodyFigure {
  view: BodyView;
  /** "0 0 w h" */
  viewBox: string;
  /** silhouette drawn first, under the muscle shapes */
  outline: string;
  shapes: BodyShape[];
}

export const BODY_FIGURES: Record<BodyView, BodyFigure> = {
  front: { view: "front", viewBox: "0 0 200 420", outline: "", shapes: [] },
  back: { view: "back", viewBox: "0 0 200 420", outline: "", shapes: [] },
};

/** which views show a region (e.g. lats: back; chest: front; delts: both) */
export function viewsForRegion(region: MuscleRegion): BodyView[] {
  void region;
  throw new Error("not implemented");
}

/**
 * map a normalized load (0..1) to a discrete intensity step 0..steps, so the
 * site and the phone shade the same way. 0 only for no load at all.
 */
export function loadIntensity(load: number | undefined, steps?: number): number {
  void load;
  void steps;
  throw new Error("not implemented");
}
