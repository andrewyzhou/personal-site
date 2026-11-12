// a rating out of five in half stars: a row of faint stars with the earned
// part drawn over it and clipped to the rating's width.
export default function Stars({ value, size = "1rem" }: { value?: number; size?: string }) {
  if (value == null) return null;
  const clamped = Math.max(0, Math.min(5, value));
  return (
    <span
      role="img"
      aria-label={`${clamped} out of 5`}
      className="font-sans"
      style={{ position: "relative", display: "inline-block", fontSize: size, lineHeight: 1, letterSpacing: "0.05em", whiteSpace: "nowrap" }}
    >
      <span aria-hidden="true" style={{ color: "var(--theme-divider)" }}>
        ★★★★★
      </span>
      <span aria-hidden="true" style={{ position: "absolute", left: 0, top: 0, overflow: "hidden", width: `${(clamped / 5) * 100}%`, color: "var(--theme-text-primary)" }}>
        ★★★★★
      </span>
    </span>
  );
}
