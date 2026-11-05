import Link from "next/link";
import { liftDateLabel, type PrFeedItem } from "@/lib/lift/public-stats";

// newest records first, one row per exercise per workout; each links to the workout that set it

const CHIP = { padding: "1px 8px", border: "1px solid var(--theme-highlight-bg-hover)", background: "var(--theme-highlight-bg)" };

export default function PrFeed({ prs, today }: { prs: PrFeedItem[]; today: string }) {
  if (prs.length === 0) return <p className="font-sans text-gray text-sm">no records yet.</p>;
  return (
    <ul className="flex flex-col" style={{ gap: "1rem" }}>
      {prs.map((p, i) => (
        <li key={`${p.href}:${p.exerciseName}:${i}`}>
          <div className="flex items-baseline justify-between" style={{ gap: "1rem" }}>
            <p className="font-sans text-off-white text-sm font-medium min-w-0">
              {p.exerciseName}{" "}
              <Link href={p.href} className="font-normal text-gray text-xs link-highlight whitespace-nowrap">
                {p.workoutTitle} →
              </Link>
            </p>
            <p className="font-sans text-gray text-xs shrink-0" style={{ fontVariantNumeric: "tabular-nums" }}>
              {liftDateLabel(p.date, today)}
            </p>
          </div>
          <ul className="flex flex-wrap" style={{ gap: "0.375rem", marginTop: "0.25rem" }}>
            {p.records.map((r) => (
              <li key={r.kind} className="font-sans text-off-white text-xs rounded" style={CHIP}>
                {r.label}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}
