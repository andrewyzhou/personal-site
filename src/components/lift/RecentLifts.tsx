import Link from "next/link";
import { liftDateLabel, type RecentLiftWorkout } from "@/lib/lift/public-stats";
import { BODY_FIGURES } from "lift-core";
import BodyFigure from "./BodyFigure";

// the thumbnail is just the shaded silhouette: no legend, and nothing when the art is missing
const HAS_ART = Object.values(BODY_FIGURES ?? {}).some((f) => f && f.shapes.length > 0);

// newest workouts, each a link to its public page (the recording's page when
// it was logged alongside one, else its own lift page)

function plural(n: number, w: string) {
  return `${n.toLocaleString("en-US")} ${w}${n === 1 ? "" : "s"}`;
}

export default function RecentLifts({ workouts, today }: { workouts: RecentLiftWorkout[]; today: string }) {
  if (workouts.length === 0) return <p className="font-sans text-gray text-sm">no workouts yet.</p>;
  return (
    <ul className="flex flex-col" style={{ gap: "0.5rem" }}>
      {workouts.map((w, i) => {
        const meta = [plural(w.exercises.length, "exercise"), plural(w.workingSets, "set")];
        if (w.volume > 0) meta.push(`${w.volume.toLocaleString("en-US")} ${w.volumeUnit}`);
        if (w.prCount > 0) meta.push(plural(w.prCount, "pr"));
        return (
          <li key={`${w.href}:${i}`}>
            <Link
              href={w.href}
              className="flex items-center rounded-lg card-bg-hover"
              style={{ gap: "1rem", padding: "0.625rem 0.75rem", margin: "0 -0.75rem" }}
            >
              <div className="shrink-0 flex justify-center [&_figcaption]:hidden" style={{ width: 64 }} aria-hidden>
                {HAS_ART && w.topRegions.length > 0 ? (
                  <BodyFigure load={w.muscleLoad} topRegions={w.topRegions} size={28} />
                ) : (
                  <span className="font-sans text-gray text-xs">—</span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between" style={{ gap: "1rem" }}>
                  <p className="font-sans text-off-white text-base font-medium truncate">{w.title}</p>
                  <p className="font-sans text-gray text-xs shrink-0" style={{ fontVariantNumeric: "tabular-nums" }}>
                    {liftDateLabel(w.date, today)}
                  </p>
                </div>
                <p className="font-sans text-secondary text-sm truncate">{w.exercises.join(", ")}</p>
                <p className="font-sans text-gray text-xs" style={{ fontVariantNumeric: "tabular-nums" }}>
                  {meta.join(" · ")}
                  {w.linked ? " · with a recording" : ""}
                </p>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
