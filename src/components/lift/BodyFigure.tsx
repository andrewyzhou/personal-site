import {
  BODY_FIGURES,
  MUSCLE_REGION_LABELS,
  loadIntensity,
  shapeLoad,
  shapeRegions,
  type BodyFigure as Figure,
  type MuscleRegion,
} from "lift-core";

// front + back figures shaded by normalized muscle load. plain svg, no client js.
// fills are the site's own text color mixed over transparent, so both themes work.

const STEPS = 4;
const mix = (pct: number) => `color-mix(in oklch, var(--theme-text-primary) ${pct}%, transparent)`;
// level 1 at 30% so a lightly worked muscle still reads on the dark theme
export const LOAD_FILLS = ["transparent", mix(30), mix(50), mix(70), mix(90)];
// faint edge on every muscle so unworked regions stay visible in both themes
export const SHAPE_STROKE = mix(28);

// lift-core's helper; same rule inline if it ever throws so the figure still renders
export function intensity(load: number | undefined): number {
  try {
    return loadIntensity(load, STEPS);
  } catch {
    return load === undefined || !(load > 0) ? 0 : Math.min(STEPS, Math.max(1, Math.ceil(load * STEPS)));
  }
}

function hasArt(f: Figure | undefined): f is Figure {
  return !!f && (f.outline.length > 0 || f.shapes.length > 0);
}

function boxOf(f: Figure): [number, number, number, number] {
  const n = f.viewBox.split(/[\s,]+/).map(Number);
  return n.length === 4 && n.every(Number.isFinite) && n[2] > 0 && n[3] > 0 ? [n[0], n[1], n[2], n[3]] : [0, 0, 165, 319];
}

export default function BodyFigure({
  load,
  topRegions,
  size = 120,
}: {
  load: Partial<Record<MuscleRegion, number>>;
  /** most-loaded first */
  topRegions: MuscleRegion[];
  /** width of each view, px */
  size?: number;
}) {
  if (topRegions.length === 0) return null;
  const labels = topRegions.map((r) => MUSCLE_REGION_LABELS[r] ?? r);
  const summary = `muscles worked, most to least: ${labels.join(", ")}`;
  const views = [BODY_FIGURES?.front, BODY_FIGURES?.back].filter(hasArt);

  // views side by side inside one svg so the <title> labels the whole figure
  const GAP = 16;
  const boxes = views.map(boxOf);
  const totalW = boxes.reduce((s, b) => s + b[2], 0) + GAP * Math.max(0, boxes.length - 1);
  const totalH = Math.max(0, ...boxes.map((b) => b[3]));
  let x = 0;

  return (
    <figure style={{ margin: 0 }}>
      {views.length > 0 ? (
        <svg
          viewBox={`0 0 ${totalW} ${totalH}`}
          role="img"
          aria-label={summary}
          style={{ width: size * views.length + 12 * (views.length - 1), height: "auto", display: "block", maxWidth: "100%" }}
        >
          <title>{summary}</title>
          {views.map((f, i) => {
            const [bx, by, bw, bh] = boxes[i];
            const at = x;
            x += bw + GAP;
            return (
              <svg key={f.view} x={at} y={0} width={bw} height={bh} viewBox={`${bx} ${by} ${bw} ${bh}`}>
                {f.outline && (
                  <path d={f.outline} fill="var(--theme-highlight-bg)" stroke="var(--theme-divider)" strokeWidth={1} />
                )}
                {f.shapes.map((s, j) => (
                  <path
                    key={j}
                    d={s.d}
                    fill={shapeRegions(s).length ? LOAD_FILLS[intensity(shapeLoad(s, load))] : "transparent"}
                    stroke={SHAPE_STROKE}
                    strokeWidth={0.75}
                    strokeLinejoin="round"
                  />
                ))}
              </svg>
            );
          })}
        </svg>
      ) : (
        // no art: the same shading as chips, so the data still reads
        <ul aria-label={summary} className="flex flex-wrap" style={{ gap: "0.375rem", maxWidth: size * 2 + 12 }}>
          {topRegions.map((r) => (
            <li
              key={r}
              className="font-sans text-off-white text-xs rounded"
              style={{ padding: "2px 8px", background: LOAD_FILLS[intensity(load[r])], border: "1px solid var(--theme-divider)" }}
            >
              {MUSCLE_REGION_LABELS[r] ?? r}
            </li>
          ))}
        </ul>
      )}
      <figcaption className="font-sans text-gray text-xs" style={{ marginTop: "0.5rem" }}>
        <span className="flex items-center" style={{ gap: "0.375rem" }}>
          less
          {LOAD_FILLS.slice(1).map((f, i) => (
            <span
              key={i}
              aria-hidden="true"
              className="inline-block rounded-sm"
              style={{ width: 12, height: 12, background: f, border: "1px solid var(--theme-divider)" }}
            />
          ))}
          more
        </span>
        <span className="block" style={{ marginTop: "0.25rem" }}>
          mostly {labels.slice(0, 3).join(", ")}
        </span>
      </figcaption>
    </figure>
  );
}
