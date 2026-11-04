import type { PublicLiftWorkout } from "@/lib/lift/public";
import BodyFigure from "./BodyFigure";
import SetTable from "./SetTable";

// a serialized (already public) workout: totals, body figure, exercises.
// `title` off when the page header already names the workout.

export function liftStats(w: PublicLiftWorkout): { label: string; value: string }[] {
  const stats = [
    { label: w.exercises.length === 1 ? "exercise" : "exercises", value: String(w.exercises.length) },
    { label: w.workingSets === 1 ? "working set" : "working sets", value: String(w.workingSets) },
  ];
  if (w.volume > 0) stats.push({ label: "volume", value: `${w.volume.toLocaleString("en-US")} ${w.volumeUnit}` });
  if (w.prs.length > 0) stats.push({ label: w.prs.length === 1 ? "pr" : "prs", value: String(w.prs.length) });
  return stats;
}

export default function LiftWorkoutCard({ workout, title = true }: { workout: PublicLiftWorkout; title?: boolean }) {
  const stats = liftStats(workout);
  return (
    <section style={{ margin: "2rem 0" }} aria-label={title ? workout.title : "workout"}>
      {title && (
        <div style={{ marginBottom: "1rem" }}>
          <h2 className="font-sans font-semibold text-off-white text-xl">{workout.title}</h2>
          <p className="font-sans text-gray text-sm">{stats.map((s) => `${s.value} ${s.label}`).join(" · ")}</p>
        </div>
      )}

      <div className="flex flex-col sm:flex-row" style={{ gap: "2rem" }}>
        {workout.topRegions.length > 0 && (
          <div className="shrink-0">
            <BodyFigure load={workout.muscleLoad} topRegions={workout.topRegions} />
          </div>
        )}
        <div className="flex flex-col min-w-0 flex-1" style={{ gap: "1.25rem" }}>
          {workout.exercises.map((e, i) => (
            <SetTable key={`${e.exerciseId}:${i}`} exercise={e} />
          ))}
          {workout.exercises.length === 0 && <p className="font-sans text-gray text-sm">no sets logged</p>}
        </div>
      </div>
    </section>
  );
}
