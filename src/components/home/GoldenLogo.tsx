// hand-coded golden-ratio mark, two layouts:
//   horizontal — 1000x618 golden rectangle, spiral starts bottom-right
//   vertical   — 618x1000 golden rectangle, spiral starts top-left
// squares and spiral share the same thin, full-brightness stroke; letters are
// bold EB Garamond glyphs. draw-on animation is pure CSS (see globals.css);
// hover dots ride the spiral via SMIL animateMotion.

// ═══════════════════════════════════════════════════════════════════
// LETTER CONTROLS — tweak these, preview live at /logo
// x = horizontal center of the glyph, y = baseline, in svg units
// (horizontal canvas is 1000x618, vertical canvas is 618x1000)
// ═══════════════════════════════════════════════════════════════════
const LETTERS = {
  horizontal: {
    fontSize: 350,
    A: { x: 191, y: 313 }, // top-left 382 square (center 191,191)
    Z: { x: 691, y: 431 }, // big right 618 square (center 691,309)
  },
  vertical: {
    fontSize: 350,
    A: { x: 309, y: 431 }, // top 618 square (center 309,309)
    Z: { x: 427, y: 931 }, // bottom-right 382 square (center 427,809)
  },
};

// construction geometry: outer rect, square-division lines, spiral path
const GEOMETRY = {
  horizontal: {
    viewBox: "-12 -12 1024 642",
    rect: { width: 1000, height: 618 },
    lines: [
      [382, 0, 382, 618],
      [0, 382, 382, 382],
      [236, 382, 236, 618],
      [236, 472, 382, 472],
      [292, 382, 292, 472],
      [236, 438, 292, 438],
      [270, 438, 270, 472],
      [270, 450, 292, 450],
      [280, 438, 280, 450],
    ],
    spiral:
      "M 1000 618 A 618 618 0 0 0 382 0 A 382 382 0 0 0 0 382 A 236 236 0 0 0 236 618 A 146 146 0 0 0 382 472 A 90 90 0 0 0 292 382 A 56 56 0 0 0 236 438 A 34 34 0 0 0 270 472 A 22 22 0 0 0 292 450 A 12 12 0 0 0 280 438",
  },
  vertical: {
    viewBox: "-12 -12 642 1024",
    rect: { width: 618, height: 1000 },
    lines: [
      [0, 618, 618, 618],
      [236, 618, 236, 1000],
      [0, 764, 236, 764],
      [146, 618, 146, 764],
      [146, 708, 236, 708],
      [180, 708, 180, 764],
      [146, 730, 180, 730],
      [168, 708, 168, 730],
      [168, 720, 180, 720],
    ],
    spiral:
      "M 0 0 A 618 618 0 0 1 618 618 A 382 382 0 0 1 236 1000 A 236 236 0 0 1 0 764 A 146 146 0 0 1 146 618 A 90 90 0 0 1 236 708 A 56 56 0 0 1 180 764 A 34 34 0 0 1 146 730 A 22 22 0 0 1 168 708 A 12 12 0 0 1 180 720",
  },
} as const;

interface GoldenLogoProps {
  layout?: "horizontal" | "vertical";
  variant?: "hero" | "mark";
  animate?: boolean;
  className?: string;
}

export default function GoldenLogo({
  layout = "horizontal",
  variant = "hero",
  animate = true,
  className = "",
}: GoldenLogoProps) {
  const geo = GEOMETRY[layout];
  const letters = LETTERS[layout];

  // draw-on props for one stroke: normalized dash + staggered delay
  const draw = (delay: number, dur = 0.9) =>
    animate
      ? {
          className: "gl-line gl-draw",
          pathLength: 1,
          style: { animationDelay: `${delay}s`, animationDuration: `${dur}s` },
        }
      : { className: "gl-line" };

  // letters fade in (glyphs can't stroke-draw)
  const fade = (delay: number) =>
    animate
      ? { className: "gl-letterform gl-fade", style: { animationDelay: `${delay}s` } }
      : { className: "gl-letterform" };

  return (
    <svg
      viewBox={geo.viewBox}
      className={`golden-logo ${variant === "hero" ? "gl-hero" : "gl-mark"} ${className}`}
      fill="none"
      aria-label="andrew zhou logo"
      role="img"
    >
      {/* construction: golden rectangle + square subdivisions */}
      <rect x="0" y="0" width={geo.rect.width} height={geo.rect.height} vectorEffect="non-scaling-stroke" {...draw(0, 1.1)} />
      {geo.lines.map(([x1, y1, x2, y2], i) => (
        <line
          key={i}
          x1={x1}
          y1={y1}
          x2={x2}
          y2={y2}
          vectorEffect="non-scaling-stroke"
          {...draw(0.45 + i * 0.15)}
        />
      ))}

      {/* letters — bold EB Garamond, positions from LETTERS above */}
      <text x={letters.A.x} y={letters.A.y} textAnchor="middle" fontSize={letters.fontSize} {...fade(1.2)}>
        A
      </text>
      <text x={letters.Z.x} y={letters.Z.y} textAnchor="middle" fontSize={letters.fontSize} {...fade(1.4)}>
        Z
      </text>

      {/* the golden spiral — drawn last, the finale */}
      <path d={geo.spiral} vectorEffect="non-scaling-stroke" {...draw(1.7, 1.8)} />

      {/* hover: two dots race the spiral, half a lap apart */}
      <circle className="gl-dot" r="9" fill="currentColor">
        <animateMotion dur="4s" repeatCount="indefinite" path={geo.spiral} />
      </circle>
      <circle className="gl-dot" r="9" fill="currentColor">
        <animateMotion dur="4s" repeatCount="indefinite" begin="-2s" path={geo.spiral} />
      </circle>
    </svg>
  );
}
