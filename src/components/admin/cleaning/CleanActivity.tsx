"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatMiles, sportLabel } from "@/lib/activity-format";
import {
  boundsOfSegments,
  cropWidens,
  currentCrop,
  fmtAt,
  fmtOffset,
  fmtRange,
  kindLabel,
  positionAt,
  removedBands,
  segmentsInRange,
  trimEffect,
  trimParams,
  type EditRow,
  type Range,
  type SuggestionRow,
  type TimeCtx,
} from "@/lib/cleaning/ui-format";
import {
  actOnSuggestion,
  createEdit,
  getCleaning,
  mergeActivity,
  previewEdits,
  revertEdit,
  splitActivity,
  type CleaningData,
  type Preview,
  type ProposedEdit,
} from "./api";
import CleanMap from "./CleanMap";
import Scrubber, { type ScrubBand } from "./Scrubber";
import StatsPanel from "./StatsPanel";
import SuggestionsPanel from "./SuggestionsPanel";
import EditHistory from "./EditHistory";

interface Props {
  id: number;
  name: string;
  sportType: string;
  utcOffsetMin: number;
}

type Pending =
  | { type: "edit"; label: string; edit: ProposedEdit }
  | { type: "suggestion"; label: string; suggestion: SuggestionRow }
  | { type: "split"; label: string; atS: number }
  | { type: "merge"; label: string; otherId: number };

const smallBtn = "font-sans text-gray text-sm link-highlight";
const bigBtn = "card-bg rounded-lg font-sans text-off-white text-sm";
const sectionTitle = "font-sans font-bold text-off-white text-lg";
const inputStyle: React.CSSProperties = {
  padding: "8px 12px",
  border: "1px solid var(--theme-highlight-bg)",
  backgroundColor: "var(--theme-card-bg)",
  borderRadius: "8px",
  width: "100%",
};

// admin clean page: before/after map, time scrubber, edit actions with a
// server preview, detector suggestions, history and stats
export default function CleanActivity({ id, name, sportType, utcOffsetMin }: Props) {
  const router = useRouter();
  const [data, setData] = useState<CleaningData | null>(null);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [splitChild, setSplitChild] = useState<number | null>(null);

  const [selection, setSelection] = useState<Range | null>(null);
  const [cursorS, setCursorS] = useState(0);
  const [hoverS, setHoverS] = useState<number | null>(null);
  const [hoverSuggestion, setHoverSuggestion] = useState<SuggestionRow | null>(null);
  const [showBefore, setShowBefore] = useState(true);
  const [showAfter, setShowAfter] = useState(true);

  const [pending, setPending] = useState<Pending | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewState, setPreviewState] = useState<"idle" | "loading" | "error">("idle");
  const [previewError, setPreviewError] = useState("");
  const [note, setNote] = useState("");
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeId, setMergeId] = useState<number | null>(null);
  const previewSeq = useRef(0);

  const load = useCallback(async () => {
    try {
      const d = await getCleaning(id);
      setData(d);
      setLoadError("");
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const track = data?.track ?? null;
  const duration = track && track.t.length ? track.t[track.t.length - 1] : 0;
  const ctx: TimeCtx = useMemo(() => ({ startEpochMs: data?.startEpochMs ?? 0, utcOffsetMin }), [data?.startEpochMs, utcOffsetMin]);
  const edits: EditRow[] = useMemo(() => data?.edits ?? [], [data]);
  const crop = useMemo(() => currentCrop(edits), [edits]);

  // map layers
  const before = useMemo(() => (track ? segmentsInRange(track) : []), [track]);
  const selSegments = useMemo(() => (track && selection ? segmentsInRange(track, selection.fromS, selection.toS) : []), [track, selection]);
  const hoverRange = hoverSuggestion?.range ?? null;
  const hoverSegments = useMemo(() => (track && hoverRange ? segmentsInRange(track, hoverRange.fromS, hoverRange.toS) : []), [track, hoverRange]);
  const cursorPos = useMemo(() => (track ? positionAt(track, hoverS ?? cursorS) : null), [track, hoverS, cursorS]);
  const bounds = useMemo(() => boundsOfSegments(before) ?? data?.published.bounds ?? null, [before, data]);
  const afterLine = preview ? preview.polyline : data?.published.polyline ?? null;

  const bands: ScrubBand[] = useMemo(() => {
    const out: ScrubBand[] = removedBands(edits, duration);
    for (const s of data?.suggestions ?? []) {
      if (s.status === "open" && s.range && s.edit) out.push({ kind: "suggestion", ...s.range });
    }
    if (hoverRange) out.push({ kind: "hover", ...hoverRange });
    return out;
  }, [edits, duration, data, hoverRange]);

  // ---- preview / apply ----

  function proposedFor(p: Pending): ProposedEdit[] {
    switch (p.type) {
      case "edit":
        return [p.edit];
      case "suggestion":
        return p.suggestion.edit ? [p.suggestion.edit] : [];
      case "split":
        // what stays on this activity: everything up to the split point
        return [{ kind: "crop", params: trimParams("end", p.atS) }];
      case "merge":
        return [{ kind: "merge", params: { withActivityId: p.otherId } }];
    }
  }

  async function startPending(p: Pending) {
    const seq = ++previewSeq.current;
    setPending(p);
    setPreview(null);
    setPreviewError("");
    setNote("");
    setMessage("");
    setPreviewState("loading");
    try {
      const pv = await previewEdits(id, proposedFor(p));
      if (seq !== previewSeq.current) return;
      setPreview(pv);
      setPreviewState("idle");
    } catch (e) {
      if (seq !== previewSeq.current) return;
      setPreviewError((e as Error).message);
      setPreviewState("error");
    }
  }

  function discard() {
    previewSeq.current++;
    setPending(null);
    setPreview(null);
    setPreviewState("idle");
    setPreviewError("");
  }

  // run a mutation, then reload the whole page state
  async function mutate(fn: () => Promise<string | void>, done: string) {
    setBusy(true);
    setMessage("");
    try {
      const m = await fn();
      setMessage(m || done);
      await load();
      return true;
    } catch (e) {
      setMessage((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    const p = pending;
    if (!p) return;
    if (p.type === "split" && !confirm(`split this activity at ${fmtAt(p.atS, ctx)}? the rest becomes a new activity.`)) return;
    if (p.type === "merge" && !confirm(`merge with activity #${p.otherId}? the later one is folded into the earlier one.`)) return;
    const out: { target: number | null } = { target: null };
    const ok = await mutate(async () => {
      if (p.type === "edit") {
        await createEdit(id, p.edit, note.trim() || undefined);
      } else if (p.type === "suggestion") {
        await actOnSuggestion(id, p.suggestion.id, "accept");
      } else if (p.type === "split") {
        const child = await splitActivity(id, p.atS);
        setSplitChild(child);
        return `split — new activity #${child}`;
      } else {
        out.target = await mergeActivity(id, p.otherId);
        return `merged into #${out.target}`;
      }
    }, "applied");
    if (!ok) return;
    discard();
    setSelection(null);
    setMergeOpen(false);
    if (out.target !== null && out.target !== id) router.push(`/admin/activities/${out.target}/clean`);
  }

  async function undo(e: EditRow) {
    if (!confirm(`undo this ${kindLabel(e.kind)}? the published track is rebuilt without it.`)) return;
    await mutate(() => revertEdit(id, e.id), "undone");
  }

  // ---- render ----

  if (!data) {
    return loadError ? (
      <div className="flex flex-col" style={{ gap: "8px" }}>
        <p className="font-sans text-gray text-sm italic">couldn&apos;t load cleaning data: {loadError}</p>
        <button className={smallBtn} onClick={load} style={{ alignSelf: "flex-start" }}>
          retry
        </button>
      </div>
    ) : (
      <p className="font-sans text-gray text-sm italic">loading…</p>
    );
  }

  const canAct = !busy && !pending && !!track && !data.syntheticTime;
  const cursorValid = cursorS > 0 && cursorS < duration;
  // crops only narrow: a trim outside the current window needs an undo first
  const startTrim = trimEffect(crop, "start", cursorS);
  const endTrim = trimEffect(crop, "end", cursorS);
  const trimHint = (e: "narrows" | "widens" | "empty") =>
    e === "widens" ? "already cropped past here — undo the crop in history to widen" : e === "empty" ? "would leave nothing" : undefined;
  const selectionWidens = !!selection && cropWidens(crop, selection.fromS, selection.toS);

  return (
    <div className="flex flex-col" style={{ gap: "16px" }}>
      <div className="flex flex-col" style={{ gap: "4px" }}>
        <h2 className="font-sans font-bold text-off-white text-xl">clean · {name || `activity #${id}`}</h2>
        <p className="font-sans text-gray text-sm">
          {sportLabel(sportType)}
          {data.splitFromId && (
            <>
              {" · split from "}
              <Link href={`/admin/activities/${data.splitFromId}/clean`} className="link-highlight">
                #{data.splitFromId}
              </Link>
            </>
          )}
          {data.children.length > 0 && (
            <>
              {" · split into "}
              {data.children.map((c, i) => (
                <span key={c.id}>
                  {i > 0 && ", "}
                  <Link href={`/admin/activities/${c.id}/clean`} className="link-highlight">
                    {c.name || `#${c.id}`}
                  </Link>
                </span>
              ))}
            </>
          )}
        </p>
        {loadError && <p className="font-sans text-gray text-sm italic">refresh failed: {loadError}</p>}
      </div>

      {!track ? (
        <p className="font-sans text-gray text-sm italic">
          {data.trackStatus === "unavailable"
            ? "the original file can't be read right now — try again later"
            : "no stored track for this activity — nothing to clean"}
        </p>
      ) : (
        <>
          <CleanMap
            before={before}
            after={afterLine}
            selection={selSegments}
            hover={hoverSegments}
            cursor={cursorPos}
            showBefore={showBefore}
            showAfter={showAfter}
            bounds={bounds}
          />
          <div className="flex flex-wrap items-center font-sans text-gray text-sm" style={{ gap: "16px" }}>
            <label className="flex items-center" style={{ gap: "6px" }}>
              <input type="checkbox" checked={showBefore} onChange={(e) => setShowBefore(e.target.checked)} style={{ accentColor: "var(--theme-text-primary)" }} />
              before (untouched)
            </label>
            <label className="flex items-center" style={{ gap: "6px" }}>
              <input type="checkbox" checked={showAfter} onChange={(e) => setShowAfter(e.target.checked)} style={{ accentColor: "var(--theme-text-primary)" }} />
              {preview ? "after (preview)" : "after (published)"}
            </label>
          </div>

          <Scrubber
            track={track}
            duration={duration}
            selection={selection}
            cursorS={cursorS}
            hoverS={hoverS}
            bands={bands}
            onSelection={setSelection}
            onCursor={setCursorS}
            onHover={setHoverS}
          />
          <p className="font-sans text-gray text-sm">
            cursor {fmtAt(cursorS, ctx)}
            {selection && (
              <>
                {" · selection "}
                {fmtRange(selection.fromS, selection.toS, ctx)} ({fmtOffset(selection.toS - selection.fromS)} long)
              </>
            )}
          </p>

          {data.syntheticTime && (
            <p className="font-sans text-gray text-sm italic">
              this activity has no timed track (route only) — crops, cuts, split and merge need real timestamps
            </p>
          )}
          <div className="flex flex-wrap" style={{ gap: "12px" }}>
            <button
              className={smallBtn}
              disabled={!canAct || !selection}
              title={selectionWidens ? "crops only narrow — the part outside the current crop stays cropped" : undefined}
              onClick={() => selection && startPending({ type: "edit", label: `crop to ${fmtRange(selection.fromS, selection.toS, ctx)}`, edit: { kind: "crop", params: { startS: selection.fromS, endS: selection.toS } } })}
            >
              crop to selection
            </button>
            <button
              className={smallBtn}
              disabled={!canAct || !cursorValid || startTrim !== "narrows"}
              title={trimHint(startTrim)}
              onClick={() => startPending({ type: "edit", label: `trim start at ${fmtAt(cursorS, ctx)}`, edit: { kind: "crop", params: trimParams("start", cursorS) } })}
            >
              trim start here
            </button>
            <button
              className={smallBtn}
              disabled={!canAct || !cursorValid || endTrim !== "narrows"}
              title={trimHint(endTrim)}
              onClick={() => startPending({ type: "edit", label: `trim end at ${fmtAt(cursorS, ctx)}`, edit: { kind: "crop", params: trimParams("end", cursorS) } })}
            >
              trim end here
            </button>
            <button
              className={smallBtn}
              disabled={!canAct || !selection}
              onClick={() => selection && startPending({ type: "edit", label: `cut ${fmtRange(selection.fromS, selection.toS, ctx)}`, edit: { kind: "cut", params: { fromS: selection.fromS, toS: selection.toS } } })}
            >
              cut selection
            </button>
            <button
              className={smallBtn}
              disabled={!canAct || !cursorValid}
              onClick={() => startPending({ type: "split", label: `split at ${fmtAt(cursorS, ctx)}`, atS: Math.round(cursorS) })}
            >
              split here
            </button>
            <button className={smallBtn} disabled={!canAct || data.mergeCandidates.length === 0} onClick={() => setMergeOpen((o) => !o)}>
              merge with…
            </button>
            <button
              className={smallBtn}
              disabled={!canAct}
              onClick={() => startPending({ type: "edit", label: "drop all gps positions", edit: { kind: "no-gps", params: {} } })}
            >
              drop gps
            </button>
          </div>

          {crop && (
            <p className="font-sans text-gray text-xs italic">
              crops stack and only narrow{crop.startS !== null ? ` · keeping from ${fmtAt(crop.startS, ctx)}` : ""}
              {crop.endS !== null ? ` · keeping until ${fmtAt(crop.endS, ctx)}` : ""} — undo a crop in history to widen
            </p>
          )}

          {mergeOpen && !pending && (
            <div className="flex flex-col" style={{ gap: "8px" }}>
              <select
                value={mergeId ?? ""}
                onChange={(e) => setMergeId(e.target.value ? Number(e.target.value) : null)}
                className="font-sans text-off-white text-sm"
                style={inputStyle}
              >
                <option value="">pick an activity to merge with</option>
                {data.mergeCandidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name || `#${c.id}`} · {new Date(c.startDateUtc).toLocaleString()} · {sportLabel(c.sportType)}
                    {c.distanceM ? ` · ${formatMiles(c.distanceM)}` : ""}
                  </option>
                ))}
              </select>
              <div className="flex" style={{ gap: "12px" }}>
                <button
                  className={smallBtn}
                  disabled={busy || mergeId === null}
                  onClick={() => mergeId !== null && startPending({ type: "merge", label: `merge with #${mergeId}`, otherId: mergeId })}
                >
                  preview merge
                </button>
                <button className={smallBtn} onClick={() => setMergeOpen(false)}>
                  cancel
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {pending && (
        <div className="flex flex-col" style={{ gap: "8px", border: "1px dashed var(--theme-divider)", borderRadius: "8px", padding: "12px" }}>
          <p className="font-sans text-off-white text-sm">preview: {pending.label}</p>
          {previewState === "loading" && <p className="font-sans text-gray text-sm italic">building preview…</p>}
          {previewState === "error" && <p className="font-sans text-gray text-sm italic">no preview: {previewError}</p>}
          {pending.type === "merge" && (
            <p className="font-sans text-gray text-xs italic">merges always fold the later activity into the earlier one.</p>
          )}
          {pending.type === "split" && (
            <p className="font-sans text-gray text-xs italic">preview shows what stays on this activity; the rest becomes a new one.</p>
          )}
          {pending.type === "edit" && (
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="note (optional)" className="font-sans text-off-white text-sm" style={inputStyle} />
          )}
          <div className="flex" style={{ gap: "12px" }}>
            <button className={bigBtn} style={{ padding: "6px 16px" }} disabled={busy || previewState === "loading"} onClick={apply}>
              {busy ? "applying…" : "apply"}
            </button>
            <button className={smallBtn} disabled={busy} onClick={discard}>
              discard
            </button>
          </div>
        </div>
      )}

      {message && (
        <p className="font-sans text-gray text-sm italic">
          {message}
          {splitChild && message.startsWith("split") && (
            <>
              {" "}
              <Link href={`/admin/activities/${splitChild}/clean`} className="link-highlight">
                open #{splitChild} →
              </Link>
            </>
          )}
        </p>
      )}

      <section className="flex flex-col" style={{ gap: "8px" }}>
        <h3 className={sectionTitle}>stats</h3>
        <StatsPanel sportType={sportType} raw={data.rawStats} published={data.published} preview={preview?.stats ?? null} />
      </section>

      <section className="flex flex-col" style={{ gap: "8px" }}>
        <h3 className={sectionTitle}>suggestions</h3>
        <SuggestionsPanel
          suggestions={data.suggestions}
          ctx={ctx}
          busy={busy || !!pending}
          onHover={setHoverSuggestion}
          onSelectRange={(s) => {
            if (!s.range) return;
            setSelection({ fromS: s.range.fromS, toS: s.range.toS });
            setCursorS(s.range.fromS);
          }}
          onPreview={(s) => startPending({ type: "suggestion", label: s.summary, suggestion: s })}
          onAccept={(s) => mutate(() => actOnSuggestion(id, s.id, "accept"), "suggestion accepted")}
          onDismiss={(s) => mutate(() => actOnSuggestion(id, s.id, "dismiss"), "suggestion dismissed")}
        />
      </section>

      <section className="flex flex-col" style={{ gap: "8px" }}>
        <h3 className={sectionTitle}>history</h3>
        <EditHistory edits={edits} ctx={ctx} busy={busy || !!pending} onUndo={undo} />
      </section>

    </div>
  );
}
