// hand-coded golden-ratio mark: a 1000x618 golden rectangle subdivided into
// squares (618, 382, 236, 146, 90) with the spiral arc through them and A/Z
// letterforms in the two largest squares. draw-on animation is pure CSS
// (pathLength-normalized dashes, see globals.css); hover dots ride the spiral
// via SMIL animateMotion.

const SPIRAL =
  "M 0 618 A 618 618 0 0 1 618 0 A 382 382 0 0 1 1000 382 A 236 236 0 0 1 764 618 A 146 146 0 0 1 618 472 A 90 90 0 0 1 708 382";

interface GoldenLogoProps {
  variant?: "hero" | "mark";
  animate?: boolean;
  className?: string;
}

export default function GoldenLogo({
  variant = "hero",
  animate = true,
  className = "",
}: GoldenLogoProps) {
  // draw-on props for one stroke: normalized dash + staggered delay
  const draw = (base: string, delay: number, dur = 0.9) =>
    animate
      ? {
          className: `${base} gl-draw`,
          pathLength: 1,
          style: { animationDelay: `${delay}s`, animationDuration: `${dur}s` },
        }
      : { className: base };

  return (
    <svg
      viewBox="-12 -12 1024 642"
      className={`golden-logo ${variant === "hero" ? "gl-hero" : "gl-mark"} ${className}`}
      fill="none"
      aria-label="andrew zhou logo"
      role="img"
    >
      {/* construction: golden rectangle + square subdivisions */}
      <rect x="0" y="0" width="1000" height="618" vectorEffect="non-scaling-stroke" {...draw("gl-frame", 0, 1.1)} />
      <line x1="618" y1="0" x2="618" y2="618" vectorEffect="non-scaling-stroke" {...draw("gl-frame", 0.45)} />
      <line x1="618" y1="382" x2="1000" y2="382" vectorEffect="non-scaling-stroke" {...draw("gl-frame", 0.65)} />
      <line x1="764" y1="382" x2="764" y2="618" vectorEffect="non-scaling-stroke" {...draw("gl-frame", 0.8)} />
      <line x1="618" y1="472" x2="764" y2="472" vectorEffect="non-scaling-stroke" {...draw("gl-frame", 0.95)} />
      <line x1="708" y1="382" x2="708" y2="472" vectorEffect="non-scaling-stroke" {...draw("gl-frame", 1.05)} />

      {/* A — in the 618 square */}
      <path d="M 309 150 L 159 490" vectorEffect="non-scaling-stroke" {...draw("gl-letter", 1.15)} />
      <path d="M 309 150 L 459 490" vectorEffect="non-scaling-stroke" {...draw("gl-letter", 1.3)} />
      <path d="M 212 370 L 406 370" vectorEffect="non-scaling-stroke" {...draw("gl-letter", 1.45, 0.6)} />

      {/* Z — in the 382 square */}
      <path d="M 709 96 L 909 96 L 709 286 L 909 286" vectorEffect="non-scaling-stroke" {...draw("gl-letter", 1.4, 1.1)} />

      {/* the golden spiral — drawn last, the finale */}
      <path d={SPIRAL} vectorEffect="non-scaling-stroke" {...draw("gl-spiral", 1.9, 1.8)} />

      {/* hover: two dots race the spiral, half a lap apart */}
      <circle className="gl-dot" r="9" fill="currentColor">
        <animateMotion dur="4s" repeatCount="indefinite" path={SPIRAL} />
      </circle>
      <circle className="gl-dot" r="9" fill="currentColor">
        <animateMotion dur="4s" repeatCount="indefinite" begin="-2s" path={SPIRAL} />
      </circle>
    </svg>
  );
}
