// hand-coded golden-ratio mark, two layouts:
//   horizontal — 987x610 fibonacci rectangle, spiral starts bottom-right
//   vertical   — 610x987 fibonacci rectangle, spiral starts top-left
// ALL geometry (squares, division lines, spiral, dot track) is generated
// algorithmically in generateCanonical()/buildLayout() below from the
// fibonacci chain 610, 377, 233, 144, 89, 55, 34, 21, 13, 8, 5 — no
// hand-plotted coordinates. letters are EB Garamond glyphs; draw-on
// animation is pure CSS (see globals.css). on hover, two dots trailing
// continuous comet streaks loop a closed track: down the spiral, then back
// out through every square via its bulge-side corner (3 corners per square).

// ═══════════════════════════════════════════════════════════════════
// LETTER CONTROLS — tweak these, preview live at /logo
// x = horizontal center of the glyph, y = baseline, in svg units
// (horizontal canvas is 987x610, vertical canvas is 610x987)
// ═══════════════════════════════════════════════════════════════════
const LETTERS = {
  horizontal: {
    fontSize: 450,
    A: { x: 405, y: 360 },
    Z: { x: 655, y: 520 },
  },
  vertical: {
    fontSize: 450,
    A: { x: 190, y: 550 },
    Z: { x: 440, y: 710 },
  },
};

// letter weight
// 400 regular · 500 medium · 600 semibold · 700 bold · 800 extrabold
const LETTER_WEIGHT = 700;

// ═══════════════════════════════════════════════════════════════════
// LINE CONTROLS
// stroke width is in SVG USER UNITS, so it scales with the logo — zooming
// keeps line/dot/letter proportions locked. rough px equivalents: at the
// 576px-wide hero render 1 unit ≈ 0.58px (so 3.4 ≈ 2px); at the 48px
// sidebar mark 1 unit ≈ 0.049px (so 10 ≈ 0.5px).
// brightness: 0 = background color (invisible) → 1 = full theme color.
// mixes the line COLOR toward the background (not opacity), so overlapping
// lines never darken. applies to squares AND curve.
// ═══════════════════════════════════════════════════════════════════
const STROKE_WIDTH = { hero: 3.4, mark: 10 };
const LINE_BRIGHTNESS = 0.5;

// ═══════════════════════════════════════════════════════════════════
// DOT CONTROLS
// ═══════════════════════════════════════════════════════════════════
const DOT_RADIUS = 4.5;
// seconds per lap (spiral + return leg through every square)
const DOT_DUR = 10;
// comet tail: a continuous streak — the track path itself, dashed so only a
// short segment is visible, slid along the path in sync with the head dot.
// TRAIL_SPAN = seconds of travel the tail covers (tail length).
// layers stack to taper the streak: longer = thinner + fainter.
// len is relative to TRAIL_SPAN, width relative to DOT_RADIUS.
const TRAIL_SPAN = 0.6;
const TAIL_LAYERS = [
  { len: 1, width: 0.8, opacity: 0.1 },
  { len: 0.7, width: 1.15, opacity: 0.14 },
  { len: 0.45, width: 1.5, opacity: 0.18 },
  { len: 0.25, width: 1.8, opacity: 0.24 },
];

// share of the lap spent on the curve — exact for any square count, since
// each square contributes a quarter-arc (π/2)·s vs two sides 2·s
const CURVE_FRACTION = Math.PI / (Math.PI + 4);

// ═══════════════════════════════════════════════════════════════════
// GEOMETRY — generated, not hand-plotted
// ═══════════════════════════════════════════════════════════════════
const FIB = [610, 377, 233, 144, 89, 55, 34, 21, 13, 8, 5];
const W = 987;
const H = 610;

interface Pt {
  x: number;
  y: number;
}

interface Arc {
  from: Pt;
  to: Pt;
  center: Pt;
  r: number;
}

// canonical construction on a 987x610 rect with the curve starting at the
// bottom-left: cut a square off the rect cycling left → top → right →
// bottom, spiraling inward. each square contributes:
//   - its quarter-arc: the center is the square corner that continues the
//     previous arc's radius, which is what makes the spiral tangent-smooth
//   - its division line (the cut edge)
// the bulge-side corner used by the return leg is derived per-arc later as
// from + to - center (the corner diagonal to the arc's center).
function generateCanonical(): { arcs: Arc[]; lines: [Pt, Pt][] } {
  let rect = { x: 0, y: 0, w: W, h: H };
  const arcs: Arc[] = [];
  const lines: [Pt, Pt][] = [];
  FIB.forEach((s, k) => {
    const { x, y, w, h } = rect;
    switch (k % 4) {
      case 0: // square on the left
        arcs.push({ from: { x, y: y + s }, to: { x: x + s, y }, center: { x: x + s, y: y + s }, r: s });
        lines.push([{ x: x + s, y }, { x: x + s, y: y + h }]);
        rect = { x: x + s, y, w: w - s, h };
        break;
      case 1: // square on the top
        arcs.push({ from: { x, y }, to: { x: x + s, y: y + s }, center: { x, y: y + s }, r: s });
        lines.push([{ x, y: y + s }, { x: x + w, y: y + s }]);
        rect = { x, y: y + s, w, h: h - s };
        break;
      case 2: // square on the right
        arcs.push({ from: { x: x + w, y }, to: { x: x + w - s, y: y + s }, center: { x: x + w - s, y }, r: s });
        lines.push([{ x: x + w - s, y }, { x: x + w - s, y: y + h }]);
        rect = { x, y, w: w - s, h };
        break;
      case 3: // square on the bottom
        arcs.push({ from: { x: x + s, y: y + h }, to: { x, y: y + h - s }, center: { x: x + s, y: y + h - s }, r: s });
        lines.push([{ x, y: y + h - s }, { x: x + w, y: y + h - s }]);
        rect = { x, y, w, h: h - s };
        break;
    }
  });
  return { arcs, lines };
}

function buildLayout(orient: "horizontal" | "vertical") {
  const { arcs, lines } = generateCanonical();
  // horizontal: mirror across x so the curve starts bottom-right
  // vertical: rotate 90° clockwise so the curve starts top-left
  const tf =
    orient === "horizontal"
      ? (p: Pt): Pt => ({ x: W - p.x, y: p.y })
      : (p: Pt): Pt => ({ x: H - p.y, y: p.x });
  const sweep = orient === "horizontal" ? 0 : 1; // mirroring flips arc direction
  const t = arcs.map((a) => ({ from: tf(a.from), to: tf(a.to), center: tf(a.center), r: a.r }));

  const spiral =
    `M ${t[0].from.x} ${t[0].from.y} ` +
    t.map((a) => `A ${a.r} ${a.r} 0 0 ${sweep} ${a.to.x} ${a.to.y}`).join(" ");

  // return leg: from the innermost square back out, crossing each square via
  // its two straight sides through the bulge-side corner (from + to - center)
  const back = [...t]
    .reverse()
    .map(
      (a) =>
        ` L ${a.from.x + a.to.x - a.center.x} ${a.from.y + a.to.y - a.center.y} L ${a.from.x} ${a.from.y}`
    )
    .join("");

  const size = orient === "horizontal" ? { w: W, h: H } : { w: H, h: W };
  return {
    viewBox: `-12 -12 ${size.w + 24} ${size.h + 24}`,
    rect: size,
    lines: lines.map(([a, b]) => [tf(a), tf(b)] as [Pt, Pt]),
    spiral,
    track: spiral + back,
  };
}

const GEOMETRY = {
  horizontal: buildLayout("horizontal"),
  vertical: buildLayout("vertical"),
};

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

  // merge LETTER_WEIGHT into the letter props (inline style wins over css)
  const withWeight = (props: { className: string; style?: React.CSSProperties }) => ({
    ...props,
    style: { ...props.style, fontWeight: LETTER_WEIGHT },
  });

  // one looping dot with a continuous comet streak. the tail is the track
  // path itself, dash-normalized (pathLength=1) so only a `len`-long segment
  // is visible, slid along the path by the gl-tail-slide keyframes. the head
  // rides the same path via css offset-path on the same clock, so head and
  // tail can never drift apart. `delay` (negative) sets the start position.
  const dot = (delay: number) => (
    <g className="gl-dot" key={delay}>
      {TAIL_LAYERS.map((l, i) => {
        const len = (TRAIL_SPAN / DOT_DUR) * l.len; // fraction of the lap
        return (
          <path
            key={i}
            className="gl-tail"
            d={geo.track}
            pathLength={1}
            strokeWidth={DOT_RADIUS * l.width}
            opacity={l.opacity}
            strokeDasharray={`${len} ${1 - len}`}
            style={{ "--gl-tail-len": len, animationDelay: `${delay}s` } as React.CSSProperties}
          />
        );
      })}
      <circle
        className="gl-dot-head"
        r={DOT_RADIUS}
        fill="currentColor"
        style={{ offsetPath: `path("${geo.track}")`, animationDelay: `${delay}s` } as React.CSSProperties}
      />
    </g>
  );

  return (
    <svg
      viewBox={geo.viewBox}
      className={`golden-logo ${variant === "hero" ? "gl-hero" : "gl-mark"} ${className}`}
      style={
        {
          "--gl-stroke": STROKE_WIDTH[variant],
          "--gl-line-brightness": LINE_BRIGHTNESS,
          "--gl-dot-dur": `${DOT_DUR}s`,
        } as React.CSSProperties
      }
      fill="none"
      aria-label="andrew zhou logo"
      role="img"
    >
      {/* construction: golden rectangle + square subdivisions */}
      <rect x="0" y="0" width={geo.rect.w} height={geo.rect.h} {...draw(0, 1.1)} />
      {geo.lines.map(([a, b], i) => (
        <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} {...draw(0.4 + i * 0.1)} />
      ))}

      {/* letters — EB Garamond, positions from LETTERS above */}
      <text x={letters.A.x} y={letters.A.y} textAnchor="middle" fontSize={letters.fontSize} {...withWeight(fade(1.2))}>
        A
      </text>
      <text x={letters.Z.x} y={letters.Z.y} textAnchor="middle" fontSize={letters.fontSize} {...withWeight(fade(1.4))}>
        Z
      </text>

      {/* the golden spiral — drawn last, the finale */}
      <path d={geo.spiral} {...draw(1.7, 1.8)} />

      {/* dot 1 starts at the curve start; dot 2 starts at the curve end */}
      {dot(0)}
      {dot(-DOT_DUR * CURVE_FRACTION)}
    </svg>
  );
}
