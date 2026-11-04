"use client";

import { fmtConfidence, fmtRange, groupSuggestions, kindLabel, type SuggestionRow, type TimeCtx } from "@/lib/cleaning/ui-format";

interface Props {
  suggestions: SuggestionRow[];
  ctx: TimeCtx;
  busy: boolean;
  onHover(s: SuggestionRow | null): void;
  onPreview(s: SuggestionRow): void;
  onAccept(s: SuggestionRow): void;
  onDismiss(s: SuggestionRow): void;
  onSelectRange(s: SuggestionRow): void;
}

const smallBtn = "font-sans text-gray text-sm link-highlight";

export default function SuggestionsPanel({ suggestions, ctx, busy, onHover, onPreview, onAccept, onDismiss, onSelectRange }: Props) {
  const { open, closed, stops } = groupSuggestions(suggestions);

  const rowProps = (s: SuggestionRow) => ({
    onMouseEnter: () => onHover(s),
    onMouseLeave: () => onHover(null),
    onFocus: () => onHover(s),
    onBlur: () => onHover(null),
  });

  return (
    <div className="flex flex-col" style={{ gap: "8px" }}>
      {open.length === 0 && <p className="font-sans text-gray text-sm italic">no open suggestions</p>}
      {open.map((s) => (
        <div key={s.id} className="card-bg rounded-lg flex flex-col" style={{ padding: "8px 12px", gap: "4px" }} {...rowProps(s)}>
          <div className="flex items-baseline justify-between" style={{ gap: "8px" }}>
            <span className="font-sans text-off-white text-sm">{s.summary}</span>
            <span className="font-sans text-gray text-xs" title="confidence">
              {fmtConfidence(s.confidence)}
            </span>
          </div>
          <div className="flex flex-wrap items-center" style={{ gap: "12px" }}>
            <span className="font-sans text-gray text-xs">{kindLabel(s.edit?.kind ?? s.kind)}</span>
            {s.range && (
              <button className="font-sans text-gray text-xs link-highlight" onClick={() => onSelectRange(s)}>
                {fmtRange(s.range.fromS, s.range.toS, ctx)}
              </button>
            )}
            <span style={{ flex: 1 }} />
            <button className={smallBtn} disabled={busy} onClick={() => onPreview(s)}>
              preview
            </button>
            <button className={smallBtn} disabled={busy} onClick={() => onAccept(s)}>
              accept
            </button>
            <button className={smallBtn} disabled={busy} onClick={() => onDismiss(s)}>
              dismiss
            </button>
          </div>
        </div>
      ))}

      {stops.length > 0 && (
        <details>
          <summary className="font-sans text-gray text-sm" style={{ cursor: "pointer" }}>
            stops ({stops.length})
          </summary>
          <ul className="flex flex-col" style={{ gap: "2px", marginTop: "4px" }}>
            {stops.map((s) => (
              <li key={s.id} className="font-sans text-gray text-sm" {...rowProps(s)}>
                {s.range ? (
                  <button className="link-highlight" onClick={() => onSelectRange(s)}>
                    {fmtRange(s.range.fromS, s.range.toS, ctx)}
                  </button>
                ) : null}{" "}
                {s.summary}
              </li>
            ))}
          </ul>
        </details>
      )}

      {closed.length > 0 && (
        <details>
          <summary className="font-sans text-gray text-sm" style={{ cursor: "pointer" }}>
            accepted / dismissed ({closed.length})
          </summary>
          <ul className="flex flex-col" style={{ gap: "2px", marginTop: "4px" }}>
            {closed.map((s) => (
              <li key={s.id} className="font-sans text-gray text-sm" {...rowProps(s)}>
                <span style={{ textDecoration: s.status === "dismissed" ? "line-through" : undefined }}>{s.summary}</span> · {s.status} ·{" "}
                {fmtConfidence(s.confidence)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
