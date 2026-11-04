import type { PublicLiftExercise } from "@/lib/lift/public";

// one exercise: name, grouped working sets, warm-ups folded away and dimmed

export default function SetTable({ exercise }: { exercise: PublicLiftExercise }) {
  const meta = [exercise.topSet && `top ${exercise.topSet}`, exercise.bestE1rm && `e1rm ${exercise.bestE1rm}`].filter(
    Boolean,
  ) as string[];
  const warmCount = exercise.warmups.reduce((s, g) => s + g.count, 0);

  return (
    <div>
      <div className="flex items-baseline justify-between" style={{ gap: "1rem" }}>
        <h3 className="font-sans font-medium text-off-white text-base">{exercise.name}</h3>
        {meta.length > 0 && <p className="font-sans text-gray text-xs shrink-0">{meta.join(" · ")}</p>}
      </div>

      {exercise.working.length > 0 && (
        <ul style={{ marginTop: "0.25rem" }}>
          {exercise.working.map((g, i) => (
            <li key={i} className="font-sans text-secondary text-sm" style={{ fontVariantNumeric: "tabular-nums" }}>
              {g.label}
            </li>
          ))}
        </ul>
      )}

      {warmCount > 0 && (
        <details className="font-sans text-gray text-xs" style={{ marginTop: "0.25rem", opacity: 0.75 }}>
          <summary className="cursor-pointer">
            {warmCount} warm-up{warmCount === 1 ? "" : "s"}
          </summary>
          <ul style={{ marginTop: "0.125rem", fontVariantNumeric: "tabular-nums" }}>
            {exercise.warmups.map((g, i) => (
              <li key={i}>{g.label}</li>
            ))}
          </ul>
        </details>
      )}

      {exercise.prs.length > 0 && (
        <ul className="flex flex-wrap" style={{ gap: "0.375rem", marginTop: "0.375rem" }}>
          {exercise.prs.map((p) => (
            <li
              key={p.kind}
              className="font-sans text-off-white text-xs rounded"
              style={{ padding: "1px 8px", border: "1px solid var(--theme-highlight-bg-hover)", background: "var(--theme-highlight-bg)" }}
            >
              pr · {p.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
