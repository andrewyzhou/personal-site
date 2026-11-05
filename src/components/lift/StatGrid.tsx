// the activity page's stat grid: value over label, three across (two on phones)

export default function StatGrid({ stats }: { stats: { label: string; value: string }[] }) {
  if (stats.length === 0) return null;
  return (
    // four fit one row; anything else wraps in threes like the activity page
    <div className={`grid grid-cols-2 ${stats.length === 4 ? "sm:grid-cols-4" : "sm:grid-cols-3"} gap-3`} style={{ margin: "2rem 0" }}>
      {stats.map((s) => (
        <div key={s.label}>
          <p className="font-sans text-off-white text-lg font-medium" style={{ fontVariantNumeric: "tabular-nums" }}>
            {s.value}
          </p>
          <p className="font-sans text-gray text-xs">{s.label}</p>
        </div>
      ))}
    </div>
  );
}
