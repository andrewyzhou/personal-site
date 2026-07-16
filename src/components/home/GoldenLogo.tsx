// hand-coded golden-ratio mark, two layouts:
//   horizontal — 987x610 fibonacci rectangle, spiral starts bottom-right
//   vertical   — 610x987 fibonacci rectangle, spiral starts top-left
// square sides run the fibonacci chain 610, 377, 233, 144, 89, 55, 34, 21,
// 13, 8, 5 (11 squares) so the progression stays exact all the way in.
// squares and spiral share the same thin, full-brightness stroke; letters are
// bold EB Garamond glyphs. draw-on animation is pure CSS (see globals.css).
// on hover, two dots with fading trails loop a closed track: down the spiral,
// then back out through every square — each square's two straight sides via
// its outer (bulge-side) corner, hitting 3 corners per square (the middle
// corner is P_in + P_out - C_arc, diagonal to the arc's center corner).

// ═══════════════════════════════════════════════════════════════════
// LETTER CONTROLS — tweak these, preview live at /logo
// x = horizontal center of the glyph, y = baseline, in svg units
// (horizontal canvas is 987x610, vertical canvas is 610x987)
// ═══════════════════════════════════════════════════════════════════
const LETTERS = {
  horizontal: {
    fontSize: 450,
    A: { x: 410, y: 340 }, // top-left 382 square (center 191,191)
    Z: { x: 670, y: 520 }, // big right 618 square (center 691,309)
  },
  vertical: {
    fontSize: 450,
    A: { x: 190, y: 550 }, // top 618 square (center 309,309)
    Z: { x: 440, y: 705 }, // bottom-right 382 square (center 427,809)
  },
};

// letter weight — eb garamond is variable 400-800:
// 400 regular · 500 medium · 600 semibold · 700 bold · 800 extrabold
const LETTER_WEIGHT = 700;

// ═══════════════════════════════════════════════════════════════════
// LINE CONTROLS
// stroke width in on-screen pixels (strokes don't scale with logo size)
// brightness: 0 = background color (invisible) → 1 = full theme color.
// mixes the line COLOR toward the background (not opacity), so overlapping
// lines never darken. applies to squares AND curve.
// ═══════════════════════════════════════════════════════════════════
const STROKE_WIDTH = { hero: 2, mark: 0.5 };
const LINE_BRIGHTNESS = 0.5;

// dot lap time in seconds (spiral + return leg through every square)
const DOT_DUR = 10;
// trail followers: radius, opacity, seconds behind the lead dot
const TRAIL = [
  { r: 3.4, o: 0.45, lag: 0.12 },
  { r: 2.6, o: 0.3, lag: 0.24 },
  { r: 1.9, o: 0.18, lag: 0.36 },
];

// construction geometry: outer rect, square-division lines, spiral path,
// closed dot track (spiral + return along construction lines), and the
// fraction of the track the spiral occupies (dot 2 starts at the spiral end)
const GEOMETRY = {
  horizontal: {
    viewBox: "-12 -12 1011 634",
    rect: { width: 987, height: 610 },
    lines: [
      [377, 0, 377, 610],
      [0, 377, 377, 377],
      [233, 377, 233, 610],
      [233, 466, 377, 466],
      [288, 377, 288, 466],
      [233, 432, 288, 432],
      [267, 432, 267, 466],
      [267, 445, 288, 445],
      [275, 432, 275, 445],
      [267, 440, 275, 440],
      [272, 440, 272, 445],
    ],
    spiral:
      "M 987 610 A 610 610 0 0 0 377 0 A 377 377 0 0 0 0 377 A 233 233 0 0 0 233 610 A 144 144 0 0 0 377 466 A 89 89 0 0 0 288 377 A 55 55 0 0 0 233 432 A 34 34 0 0 0 267 466 A 21 21 0 0 0 288 445 A 13 13 0 0 0 275 432 A 8 8 0 0 0 267 440 A 5 5 0 0 0 272 445",
    trackReturn:
      " L 267 445 L 267 440 L 275 440 L 275 432 L 288 432 L 288 445 L 267 445 L 267 466 L 233 466 L 233 432 L 288 432 L 288 377 L 377 377 L 377 466 L 377 610 L 233 610 L 0 610 L 0 377 L 0 0 L 377 0 L 987 0 L 987 610",
    curveFraction: 0.44,
  },
  vertical: {
    viewBox: "-12 -12 634 1011",
    rect: { width: 610, height: 987 },
    lines: [
      [0, 610, 610, 610],
      [233, 610, 233, 987],
      [0, 754, 233, 754],
      [144, 610, 144, 754],
      [144, 699, 233, 699],
      [178, 699, 178, 754],
      [144, 720, 178, 720],
      [165, 699, 165, 720],
      [165, 712, 178, 712],
      [170, 712, 170, 720],
      [165, 715, 170, 715],
    ],
    spiral:
      "M 0 0 A 610 610 0 0 1 610 610 A 377 377 0 0 1 233 987 A 233 233 0 0 1 0 754 A 144 144 0 0 1 144 610 A 89 89 0 0 1 233 699 A 55 55 0 0 1 178 754 A 34 34 0 0 1 144 720 A 21 21 0 0 1 165 699 A 13 13 0 0 1 178 712 A 8 8 0 0 1 170 720 A 5 5 0 0 1 165 715",
    trackReturn:
      " L 165 720 L 170 720 L 170 712 L 178 712 L 178 699 L 165 699 L 165 720 L 144 720 L 144 754 L 178 754 L 178 699 L 233 699 L 233 610 L 144 610 L 0 610 L 0 754 L 0 987 L 233 987 L 610 987 L 610 610 L 610 0 L 0 0",
    curveFraction: 0.44,
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
  const track = geo.spiral + geo.trackReturn;

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

  // merge LETTER_WEIGHT into the letter props (inline style wins over css)
  const withWeight = (props: { className: string; style?: React.CSSProperties }) => ({
    ...props,
    style: { ...props.style, fontWeight: LETTER_WEIGHT },
  });

  // one looping dot + its fading trail, offset along the shared track
  const dot = (begin: number) => (
    <g className="gl-dot" key={begin}>
      <circle r="4.5" fill="currentColor">
        <animateMotion dur={`${DOT_DUR}s`} repeatCount="indefinite" begin={`${begin}s`} path={track} />
      </circle>
      {TRAIL.map((t) => (
        <circle key={t.lag} r={t.r} fill="currentColor" opacity={t.o}>
          <animateMotion dur={`${DOT_DUR}s`} repeatCount="indefinite" begin={`${begin + t.lag}s`} path={track} />
        </circle>
      ))}
    </g>
  );

  return (
    <svg
      viewBox={geo.viewBox}
      className={`golden-logo ${variant === "hero" ? "gl-hero" : "gl-mark"} ${className}`}
      style={
        {
          "--gl-stroke": `${STROKE_WIDTH[variant]}px`,
          "--gl-line-brightness": LINE_BRIGHTNESS,
        } as React.CSSProperties
      }
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
          {...draw(0.4 + i * 0.1)}
        />
      ))}

      {/* letters — bold EB Garamond, positions from LETTERS above */}
      <text x={letters.A.x} y={letters.A.y} textAnchor="middle" fontSize={letters.fontSize} {...withWeight(fade(1.2))}>
        A
      </text>
      <text x={letters.Z.x} y={letters.Z.y} textAnchor="middle" fontSize={letters.fontSize} {...withWeight(fade(1.4))}>
        Z
      </text>

      {/* the golden spiral — drawn last, the finale */}
      <path d={geo.spiral} vectorEffect="non-scaling-stroke" {...draw(1.7, 1.8)} />

      {/* dot 1 starts at the curve start; dot 2 starts at the curve end */}
      {dot(0)}
      {dot(-DOT_DUR * geo.curveFraction)}
    </svg>
  );
}
