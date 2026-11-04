// the site's tokens are achromatic oklch; this turns them into srgb hex so the
// phone uses the exact same grays. pure so it runs under vitest.

function hex2(n: number): string {
  return Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, "0");
}

function encode(linear: number): number {
  const c = Math.min(1, Math.max(0, linear));
  return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
}

/**
 * oklch(L% 0 0) -> "#rrggbb". with a = b = 0 every lms channel equals L, and
 * each row of the lms -> linear srgb matrix sums to 1, so linear = L^3.
 */
export function oklchGrayToHex(lightnessPct: number): string {
  const l = lightnessPct / 100;
  const v = hex2(encode(l * l * l) * 255);
  return `#${v}${v}${v}`;
}

function channels(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

/** `fg` at `alpha` over opaque `bg`, blended in srgb like css does */
export function overlay(fg: string, bg: string, alpha: number): string {
  const f = channels(fg);
  const b = channels(bg);
  return `#${f.map((c, i) => hex2(c * alpha + b[i]! * (1 - alpha))).join("")}`;
}
