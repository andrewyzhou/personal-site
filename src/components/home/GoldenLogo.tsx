// hand-coded golden-ratio mark, two layouts:
//   horizontal — 1597x987 fibonacci rectangle, spiral starts bottom-right
//   vertical   — 987x1597 fibonacci rectangle, spiral starts top-left
// ALL geometry (squares, division lines, spiral, dot track) is generated
// algorithmically in generateCanonical()/buildLayout() below from the
// fibonacci chain 987, 610, 377, 233, 144, 89, 55, 34, 21, 13, 8, 5, 3, 2,
// 1, 1 (16 squares) — no hand-plotted coordinates. letters are EB Garamond glyphs; draw-on
// animation is pure CSS (see globals.css). on hover, two dots trailing
// continuous comet streaks loop a closed track: down the spiral, then back
// out through every square via its bulge-side corner (3 corners per square).

// ═══════════════════════════════════════════════════════════════════
// LETTER CONTROLS — tweak these, preview live at /logo
// x = horizontal center of the glyph, y = baseline, in svg units
// (horizontal canvas is 1597x987, vertical canvas is 987x1597)
// ═══════════════════════════════════════════════════════════════════
const LETTERS = {
  horizontal: {
    fontSize: 728,
    A: { x: 655, y: 583 },
    Z: { x: 1060, y: 841 },
  },
  vertical: {
    fontSize: 728,
    A: { x: 307, y: 890 },
    Z: { x: 712, y: 1149 },
  },
};

// letter weight
// 400 regular · 500 medium · 600 semibold · 700 bold · 800 extrabold
const LETTER_WEIGHT = 700;

// ═══════════════════════════════════════════════════════════════════
// LINE CONTROLS
// stroke width is in SVG USER UNITS, so it scales with the logo — zooming
// keeps line/dot/letter proportions locked. rough px equivalents: at the
// 576px-wide hero render 1 unit ≈ 0.36px (so 5.5 ≈ 2px); at the 48px
// sidebar mark 1 unit ≈ 0.03px (so 16 ≈ 0.5px).
// brightness: 0 = background color (invisible) → 1 = full theme color.
// mixes the line COLOR toward the background (not opacity), so overlapping
// lines never darken. applies to squares AND curve.
// ═══════════════════════════════════════════════════════════════════
const STROKE_WIDTH = { hero: 5.5, mark: 16 };
const LINE_BRIGHTNESS = 0.5;

// ═══════════════════════════════════════════════════════════════════
// DOT CONTROLS
// ═══════════════════════════════════════════════════════════════════
// seconds per lap (spiral + return leg through every square)
const DOT_DUR = 10;
// the trail: ONE unbroken segment of the track path, stroked at the same
// width as the construction lines, sliding in lockstep with the head dot
// (which is also exactly line-width). the fade along the streak is built
// from TRAIL_STEPS nested sub-segments (each contains the next, all ending
// at the head — geometrically one continuous line), with per-layer alphas
// solved below so the CUMULATIVE fade is a smooth linear ramp
// TRAIL_MAX_ALPHA (at the head) → 0 (at the tip).
const TRAIL_LENGTH = 0.6; // tail length, in seconds of travel
const TRAIL_STEPS = 16; // fade smoothness (raise if you can see banding)
const TRAIL_MAX_ALPHA = 0.9; // streak brightness at the head

// per-layer alphas: band k (of N) sits under layers k..N, so solve
// 1 - a_k = (1 - A_k) / (1 - A_{k+1}) with target band alpha
// A_k = MAX * (N - k + 1) / N — a linear ramp after compositing
const TRAIL_ALPHAS = Array.from({ length: TRAIL_STEPS }, (_, i) => {
  const band = (k: number) =>
    k > TRAIL_STEPS ? 0 : (TRAIL_MAX_ALPHA * (TRAIL_STEPS - k + 1)) / TRAIL_STEPS;
  return 1 - (1 - band(i + 1)) / (1 - band(i + 2));
});

// varying-speed cycle: each dot runs SPEED_MIN at its own start, accelerates
// CONTINUOUSLY (constant acceleration) to SPEED_MAX by its phase boundary,
// then decelerates continuously back to SPEED_MIN by lap's end. dot 1
// (starts at curve start) peaks at the curve→squares handoff; dot 2 (starts
// at curve end) peaks at the squares→curve handoff — opposite trajectories.
// speeds are in units of the old constant speed (lap length / DOT_DUR);
// both phases share average (min+max)/2, so a lap takes DOT_DUR / avg.
const SPEED_MIN = 0.1;
const SPEED_MAX = 4;
const SPEED_RATIO = SPEED_MAX / SPEED_MIN;

// share of the lap that is the curve — exact for any square count, since
// each square contributes a quarter-arc (π/2)·s vs two return sides 2·s
const CURVE_FRACTION = Math.PI / (Math.PI + 4);

// a constant-acceleration distance profile is a quadratic in time, which a
// cubic-bezier easing represents EXACTLY: x controls at 1/3, 2/3 make
// bezier-x the identity, and the y controls below solve the quadratic.
const ACCEL = `cubic-bezier(0.3333, ${(2 / (3 * (1 + SPEED_RATIO))).toFixed(4)}, 0.6667, ${(
  (SPEED_RATIO + 3) /
  (3 * (1 + SPEED_RATIO))
).toFixed(4)})`;
const DECEL = `cubic-bezier(0.3333, ${((2 * SPEED_RATIO) / (3 * (1 + SPEED_RATIO))).toFixed(4)}, 0.6667, ${(
  (3 * SPEED_RATIO + 1) /
  (3 * (1 + SPEED_RATIO))
).toFixed(4)})`;

// per-dot keyframes: because both phases have equal average speed, the time
// fraction of the phase boundary equals its distance fraction `mid`. head
// (offset-distance) and tail (dashoffset, via the per-layer --gl-tail-len
// var) share the identical profile so they can never drift.
function speedKeyframes(name: string, mid: number): string {
  const pct = (mid * 100).toFixed(2);
  return `
@keyframes gl-ride-${name} {
  0% { offset-distance: 0%; animation-timing-function: ${ACCEL}; }
  ${pct}% { offset-distance: ${pct}%; animation-timing-function: ${DECEL}; }
  100% { offset-distance: 100%; }
}
@keyframes gl-tail-${name} {
  0% { stroke-dashoffset: calc(var(--gl-tail-len) * 1px); animation-timing-function: ${ACCEL}; }
  ${pct}% { stroke-dashoffset: calc((var(--gl-tail-len) - ${mid.toFixed(4)}) * 1px); animation-timing-function: ${DECEL}; }
  100% { stroke-dashoffset: calc((var(--gl-tail-len) - 1) * 1px); }
}`;
}

const SPEED_KEYFRAMES =
  speedKeyframes("from-start", CURVE_FRACTION) + speedKeyframes("from-end", 1 - CURVE_FRACTION);

// the streak cycle may not start until the draw-on animation has finished:
// the spiral is the last stroke to draw (delay 1.7s + duration 1.8s below)
const DRAW_END = 1.7 + 1.8;

// ═══════════════════════════════════════════════════════════════════
// GEOMETRY — generated, not hand-plotted
// ═══════════════════════════════════════════════════════════════════
const FIB = [987, 610, 377, 233, 144, 89, 55, 34, 21, 13, 8, 5, 3, 2, 1, 1];
const W = 1597;
const H = 987;

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
  const arcCmds = t.map((a) => `A ${a.r} ${a.r} 0 0 ${sweep} ${a.to.x} ${a.to.y}`).join(" ");
  const eye = t[t.length - 1].to;
  return {
    viewBox: `-20 -20 ${size.w + 40} ${size.h + 40}`,
    rect: size,
    lines: lines.map(([a, b]) => [tf(a), tf(b)] as [Pt, Pt]),
    spiral,
    // same closed loop, two phase origins: dot 1 starts at the curve start,
    // dot 2 starts at the curve end (the eye) — return leg first, then arcs.
    // both are needed because css animation-delay must stay positive for the
    // draw-gate, so start position has to live in the path itself.
    track: spiral + back,
    trackFromEnd: `M ${eye.x} ${eye.y}` + back + " " + arcCmds,
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

  // dots wait for the draw-on animation to finish, then launch from their
  // posts (fill-mode: backwards parks them there during the delay)
  const dotDelay = animate ? DRAW_END : 0;

  // one looping dot + streak. each tail layer is the track path itself,
  // dash-normalized (pathLength=1, px dash values — safari rejects unitless)
  // so only a segment ending at the head is visible, slid along the path by
  // the gl-tail-slide keyframes. layer k covers the last (k/N)·TRAIL_LENGTH
  // seconds of travel; nested layers composite into the linear fade. the
  // head rides the same path via css offset-path on the same clock, so head
  // and streak can never drift.
  const dot = (track: string, phase: "from-start" | "from-end") => (
    <g
      className="gl-dot"
      key={phase}
      // gl-gate keeps the comet invisible until the draw-on animation ends,
      // so the parked from-state never shows on load
      style={animate ? { animation: `gl-gate 1ms linear ${dotDelay}s both` } : undefined}
    >
      {TRAIL_ALPHAS.map((alpha, i) => {
        const len = (TRAIL_LENGTH / DOT_DUR) * ((i + 1) / TRAIL_STEPS); // fraction of the lap
        return (
          <path
            key={i}
            className="gl-tail"
            d={track}
            pathLength={1}
            opacity={alpha}
            strokeDasharray={`${len}px ${1 - len}px`}
            style={
              {
                "--gl-tail-len": len,
                animationName: `gl-tail-${phase}`,
                animationDelay: `${dotDelay}s`,
              } as React.CSSProperties
            }
          />
        );
      })}
      <circle
        className="gl-dot-head"
        r={STROKE_WIDTH[variant] / 2}
        fill="currentColor"
        style={
          {
            offsetPath: `path("${track}")`,
            animationName: `gl-ride-${phase}`,
            animationDelay: `${dotDelay}s`,
          } as React.CSSProperties
        }
      />
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
          "--gl-dot-dur": `${DOT_DUR / ((SPEED_MIN + SPEED_MAX) / 2)}s`,
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

      {/* per-dot varying-speed keyframes (also used by the tails) */}
      <style>{SPEED_KEYFRAMES}</style>

      {/* dot 1 starts at the curve start; dot 2 starts at the curve end —
          both launch together once the draw-on animation completes */}
      {dot(geo.track, "from-start")}
      {dot(geo.trackFromEnd, "from-end")}
    </svg>
  );
}
