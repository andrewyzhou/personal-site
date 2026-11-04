"use client";

import Link from "next/link";
import { editLinkId, editParamsLabel, isRevertable, kindLabel, newestFirst, type EditRow, type TimeCtx } from "@/lib/cleaning/ui-format";

interface Props {
  edits: EditRow[];
  ctx: TimeCtx;
  busy: boolean;
  onUndo(e: EditRow): void;
}

const fmtDate = (s: string) => {
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d.toLocaleString() : s;
};

// every edit newest first; reverted ones struck through
export default function EditHistory({ edits, ctx, busy, onUndo }: Props) {
  if (edits.length === 0) return <p className="font-sans text-gray text-sm italic">no edits yet — the published track is the untouched one</p>;
  return (
    <ul className="flex flex-col" style={{ gap: "6px" }}>
      {newestFirst(edits).map((e) => {
        const linkId = editLinkId(e.kind, e.params);
        const reverted = !!e.revertedAt;
        return (
          <li key={e.id} className="card-bg rounded-lg flex flex-col" style={{ padding: "8px 12px", gap: "2px", opacity: reverted ? 0.6 : 1 }}>
            <div className="flex items-baseline justify-between" style={{ gap: "8px" }}>
              <span className="font-sans text-sm" style={{ textDecoration: reverted ? "line-through" : undefined }}>
                <span className="text-off-white">{kindLabel(e.kind)}</span>{" "}
                <span className="text-gray">{editParamsLabel(e.kind, e.params, ctx)}</span>
              </span>
              {isRevertable(e) && (
                <button className="font-sans text-gray text-sm link-highlight" disabled={busy} onClick={() => onUndo(e)}>
                  undo
                </button>
              )}
            </div>
            <div className="flex flex-wrap font-sans text-gray text-xs" style={{ gap: "8px" }}>
              <span>{fmtDate(e.createdAt)}</span>
              {reverted && <span>reverted {fmtDate(e.revertedAt!)}</span>}
              {linkId && (
                <Link href={`/admin/activities/${linkId}/clean`} className="link-highlight">
                  activity #{linkId} →
                </Link>
              )}
            </div>
            {e.note && <p className="font-sans text-gray text-xs italic">{e.note}</p>}
          </li>
        );
      })}
    </ul>
  );
}
