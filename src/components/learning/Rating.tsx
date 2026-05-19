interface Props {
  value?: number;
  outOf?: number;
}

export default function Rating({ value, outOf = 5 }: Props) {
  if (value == null) return null;
  const filled = Math.round(value);
  return (
    <span className="font-sans text-gray text-base" aria-label={`${filled} out of ${outOf}`}>
      {"★".repeat(filled)}
      <span style={{ color: "var(--theme-divider)" }}>{"★".repeat(outOf - filled)}</span>
    </span>
  );
}
