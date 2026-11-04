"use client";

import { statRows, zoneFractions, type StatsLike } from "@/lib/cleaning/ui-format";

interface Props {
  sportType: string;
  raw: StatsLike | null;
  published: (StatsLike & { hrZonesS: number[] | null }) | null;
  preview: (StatsLike & { hrZonesS: number[] | null }) | null;
}

const cell: React.CSSProperties = { padding: "4px 8px", textAlign: "right", whiteSpace: "nowrap" };

function ZoneBar({ zones }: { zones: number[] | null }) {
  const f = zoneFractions(zones);
  if (!f) return <span className="text-gray">—</span>;
  return (
    <span
      title={f.map((x, i) => `z${i + 1} ${Math.round(x * 100)}%`).join(" · ")}
      style={{ display: "inline-flex", width: 96, height: 8, borderRadius: 4, overflow: "hidden", verticalAlign: "middle" }}
    >
      {f.map((x, i) => (
        <span
          key={i}
          style={{ width: `${x * 100}%`, backgroundColor: "var(--theme-text-primary)", opacity: 0.2 + (0.8 * (i + 1)) / f.length }}
        />
      ))}
    </span>
  );
}

// raw (untouched) vs published (cleaned) vs preview
export default function StatsPanel({ sportType, raw, published, preview }: Props) {
  const cols = preview ? [raw, published, preview] : [raw, published];
  const heads = preview ? ["raw", "published", "preview"] : ["raw", "published"];
  const rows = statRows(sportType, cols);
  return (
    <div className="card-bg rounded-lg" style={{ padding: "8px", overflowX: "auto" }}>
      <table className="font-sans text-sm" style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr className="text-gray text-xs">
            <th style={{ ...cell, textAlign: "left" }} />
            {heads.map((h) => (
              <th key={h} style={cell} className="font-normal">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <td style={{ ...cell, textAlign: "left" }} className="text-gray">
                {r.label}
              </td>
              {r.values.map((v, i) => (
                <td
                  key={i}
                  style={cell}
                  className={preview && i === 2 && v !== r.values[1] ? "text-off-white font-bold" : "text-off-white"}
                >
                  {v}
                </td>
              ))}
            </tr>
          ))}
          <tr>
            <td style={{ ...cell, textAlign: "left" }} className="text-gray">
              hr zones
            </td>
            <td style={cell} className="text-gray">
              —
            </td>
            <td style={cell}>
              <ZoneBar zones={published?.hrZonesS ?? null} />
            </td>
            {preview && (
              <td style={cell}>
                <ZoneBar zones={preview.hrZonesS} />
              </td>
            )}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
