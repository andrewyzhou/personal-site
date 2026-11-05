// stand-in for the real map (the 3d activity map) so the lab shows map
// chrome, route color and start/end markers from tokens without network tiles

const ROUTE = "M58 212 C 96 190, 120 202, 150 176 S 205 120, 236 132 S 290 170, 318 140 S 360 74, 402 88 S 452 132, 470 110 S 520 60, 548 70";

export function SpecimenMap() {
  return (
    <svg viewBox="0 0 600 300" preserveAspectRatio="xMidYMid meet" width="100%" height="100%" aria-hidden style={{ display: "block" }}>
      <rect width="600" height="300" fill="var(--ds-map-bg)" />
      <path d="M0 250 C 120 230, 210 268, 330 240 S 520 220, 600 236 L600 300 L0 300Z" fill="var(--ds-map-water)" />
      <g stroke="var(--ds-map-road)" strokeWidth="6" fill="none" strokeLinecap="round">
        <path d="M0 60 L600 100" />
        <path d="M120 0 L170 300" />
        <path d="M380 0 L340 300" />
        <path d="M0 160 C 200 150, 400 190, 600 170" />
      </g>
      <g stroke="var(--ds-map-road)" strokeWidth="2" fill="none" opacity="0.8">
        <path d="M0 30 L600 50" />
        <path d="M260 0 L250 300" />
        <path d="M480 0 L500 300" />
        <path d="M0 210 L600 200" />
      </g>
      {/* kept inside the middle of the frame so cropping never cuts the markers */}
      <g transform="translate(150 70) scale(0.5)">
        <path d={ROUTE} stroke="var(--ds-route-casing)" strokeWidth="12" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <path d={ROUTE} stroke="var(--ds-accent)" strokeWidth="6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="58" cy="212" r="10" fill="var(--ds-accent)" stroke="var(--ds-marker-ring)" strokeWidth="4" />
        <g transform="translate(548 70)">
          <circle r="12" fill="var(--ds-marker-ring)" />
          <circle r="8" fill="none" stroke="var(--ds-fg)" strokeWidth="3.5" />
        </g>
      </g>
    </svg>
  );
}
