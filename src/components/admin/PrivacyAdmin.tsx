"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PrivacyZoneMap, { type MapZone } from "./PrivacyZoneMap";

interface ZoneVersion {
  id: number;
  name: string;
  polygon: number[][][];
  enabled: boolean;
  replacesId: number | null;
  archivedAt: string | null;
  createdAt: string;
}

interface ZoneGroup {
  rootId: number;
  active: ZoneVersion | null;
  versions: ZoneVersion[];
}

interface Settings {
  distance: { mode: "include-rounded" | "include-exact" | "visible-only"; roundToM: number };
  coarsenStartMin: number;
  defaultTrimM: number;
}

type Mode = { kind: "idle" } | { kind: "draw"; ring: number[][] } | { kind: "edit"; id: number; ring: number[][] };

const inputStyle: React.CSSProperties = {
  padding: "8px 12px",
  border: "1px solid var(--theme-highlight-bg)",
  backgroundColor: "var(--theme-card-bg)",
  borderRadius: "8px",
  width: "100%",
};
const smallBtn = "font-sans text-gray text-sm link-highlight";
const bigBtn = "card-bg rounded-lg font-sans text-off-white text-sm";

const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleString() : "");

// open ring (no closing vertex) for editing
function openRing(polygon: number[][][]): number[][] {
  const ring = (polygon[0] ?? []).map((p) => [p[0], p[1]]);
  const a = ring[0], b = ring[ring.length - 1];
  if (ring.length > 1 && a[0] === b[0] && a[1] === b[1]) ring.pop();
  return ring;
}
const closeRing = (ring: number[][]) => [...ring, ring[0]];

async function call(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.ok) throw new Error(json?.error ?? `request failed (${res.status})`);
  return json;
}

export default function PrivacyAdmin({ coarsenOptions }: { coarsenOptions: number[] }) {
  const [groups, setGroups] = useState<ZoneGroup[] | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [pending, setPending] = useState<number | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: "idle" });
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [newName, setNewName] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [z, s] = await Promise.all([call("/api/admin/privacy/zones", "GET"), call("/api/admin/privacy/settings", "GET")]);
      setGroups(z.zones);
      setPending(z.pending);
      setSettings(s.settings);
    } catch (error) {
      setMessage((error as Error).message);
      setGroups([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // run a mutation, then refresh everything
  async function mutate(fn: () => Promise<{ pending?: number }>, done: string) {
    setBusy(true);
    setMessage("");
    try {
      const r = await fn();
      if (typeof r.pending === "number") setPending(r.pending);
      setMessage(done);
      await load();
      return true;
    } catch (error) {
      setMessage((error as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  const activeZones: MapZone[] = useMemo(
    () => (groups ?? []).filter((g) => g.active).map((g) => g.active!),
    [groups]
  );
  const archivedGroups = (groups ?? []).filter((g) => !g.active);
  const draft = mode.kind === "idle" ? null : mode.ring;
  const mapZones = useMemo(
    // hide the zone being reshaped; the draft stands in for it
    () => (mode.kind === "edit" ? activeZones.filter((z) => z.id !== mode.id) : activeZones),
    [activeZones, mode]
  );

  async function finishDraw() {
    if (mode.kind !== "draw" || mode.ring.length < 3) return;
    const ok = await mutate(
      () => call("/api/admin/privacy/zones", "POST", { name: newName, polygon: [closeRing(mode.ring)] }),
      "zone added"
    );
    if (ok) {
      setMode({ kind: "idle" });
      setNewName("");
    }
  }

  async function saveShape() {
    if (mode.kind !== "edit") return;
    // zones are a single ring: holes would leave part of the zone visible
    const ok = await mutate(
      () => call(`/api/admin/privacy/zones/${mode.id}`, "PATCH", { polygon: [closeRing(mode.ring)] }),
      "shape saved as a new version"
    );
    if (ok) {
      setMode({ kind: "idle" });
      setSelectedId(null);
    }
  }

  return (
    <div className="flex flex-col admin-cms" style={{ gap: "16px" }}>
      <h2 className="font-sans font-bold text-off-white text-xl">privacy zones</h2>
      <p className="font-sans text-gray text-sm">
        routes are hidden inside these shapes. a zone&apos;s shape (outer ring, rounded) is shown publicly as fog on
        routes it touches, so draw it loosely around the place — don&apos;t center it on anything private.
      </p>

      <PrivacyZoneMap
        zones={mapZones}
        selectedId={mode.kind === "idle" ? selectedId : null}
        draft={draft}
        draftMode={mode.kind === "idle" ? null : mode.kind}
        onDraftChange={(ring) => setMode((m) => (m.kind === "idle" ? m : { ...m, ring }))}
        onFinish={finishDraw}
        onSelect={setSelectedId}
      />

      {mode.kind === "idle" && (
        <div className="flex flex-col" style={{ gap: "8px" }}>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="new zone name (private)"
            className="font-sans text-off-white text-sm"
            style={inputStyle}
          />
          <button className={bigBtn} style={{ padding: "10px" }} onClick={() => setMode({ kind: "draw", ring: [] })} disabled={busy}>
            draw a new zone
          </button>
        </div>
      )}

      {mode.kind === "draw" && (
        <div className="flex flex-col" style={{ gap: "8px" }}>
          <p className="font-sans text-gray text-sm italic">
            click the map to add points ({mode.ring.length} so far); click the first point or finish to close. drag a
            point to move it, right-click to remove it.
          </p>
          <div className="flex" style={{ gap: "12px" }}>
            <button className={smallBtn} disabled={busy || mode.ring.length < 3} onClick={finishDraw}>
              finish
            </button>
            <button className={smallBtn} disabled={mode.ring.length === 0} onClick={() => setMode({ kind: "draw", ring: mode.ring.slice(0, -1) })}>
              undo last point
            </button>
            <button className={smallBtn} onClick={() => setMode({ kind: "idle" })}>
              cancel
            </button>
          </div>
        </div>
      )}

      {mode.kind === "edit" && (
        <div className="flex flex-col" style={{ gap: "8px" }}>
          <p className="font-sans text-gray text-sm italic">
            drag points to reshape; drag a small midpoint to add a point; right-click a point to remove it. saving
            keeps the old shape in history.
          </p>
          <div className="flex" style={{ gap: "12px" }}>
            <button className={smallBtn} disabled={busy} onClick={saveShape}>
              save shape
            </button>
            <button className={smallBtn} onClick={() => setMode({ kind: "idle" })}>
              cancel
            </button>
          </div>
        </div>
      )}

      {message && <p className="font-sans text-gray text-sm italic">{message}</p>}

      <div className="flex flex-col" style={{ gap: "10px" }}>
        {groups === null && <p className="font-sans text-gray text-sm">loading…</p>}
        {groups && activeZones.length === 0 && <p className="font-sans text-gray text-sm">no active zones</p>}
        {(groups ?? [])
          .filter((g) => g.active)
          .map((g) => (
            <ZoneCard
              key={g.rootId}
              group={g}
              selected={selectedId === g.active!.id}
              busy={busy || mode.kind !== "idle"}
              onSelect={() => setSelectedId(g.active!.id)}
              onEditShape={() => {
                setSelectedId(g.active!.id);
                setMode({ kind: "edit", id: g.active!.id, ring: openRing(g.active!.polygon) });
              }}
              mutate={mutate}
            />
          ))}
      </div>

      {archivedGroups.length > 0 && (
        <div className="flex flex-col" style={{ gap: "8px" }}>
          <h3 className="font-sans text-off-white text-sm">archived zones</h3>
          {archivedGroups.map((g) => (
            <div key={g.rootId} className="card-bg rounded-lg" style={{ padding: "10px 12px" }}>
              <History versions={g.versions} busy={busy} mutate={mutate} />
              <div className="flex justify-end" style={{ marginTop: "6px" }}>
                <button
                  className={smallBtn}
                  disabled={busy}
                  onClick={() => {
                    if (!confirm("delete this zone and all its versions for good? this can't be undone.")) return;
                    mutate(() => call(`/api/admin/privacy/zones/${g.rootId}?purge=1`, "DELETE"), "zone deleted");
                  }}
                >
                  delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <RebuildPanel pending={pending} setPending={setPending} />

      {settings && <SettingsForm initial={settings} coarsenOptions={coarsenOptions} mutate={mutate} />}
    </div>
  );
}

type Mutate = (fn: () => Promise<{ pending?: number }>, done: string) => Promise<boolean>;

function ZoneCard({
  group,
  selected,
  busy,
  onSelect,
  onEditShape,
  mutate,
}: {
  group: ZoneGroup;
  selected: boolean;
  busy: boolean;
  onSelect(): void;
  onEditShape(): void;
  mutate: Mutate;
}) {
  const zone = group.active!;
  const [name, setName] = useState(zone.name);
  const [open, setOpen] = useState(false);
  const history = group.versions.filter((v) => v.id !== zone.id);

  return (
    <div
      className="card-bg rounded-lg flex flex-col"
      style={{ padding: "10px 12px", gap: "8px", outline: selected ? "1px solid var(--theme-text-muted)" : undefined }}
    >
      <div className="flex items-center" style={{ gap: "8px" }}>
        <input value={name} onChange={(e) => setName(e.target.value)} onFocus={onSelect} className="font-sans text-off-white text-sm" style={inputStyle} />
        {name !== zone.name && (
          <button
            className={smallBtn}
            disabled={busy}
            onClick={() => mutate(() => call(`/api/admin/privacy/zones/${zone.id}`, "PATCH", { name }), "renamed")}
          >
            rename
          </button>
        )}
      </div>
      <div className="flex items-center justify-between" style={{ gap: "8px", flexWrap: "wrap" }}>
        <label className="font-sans text-gray text-sm flex items-center" style={{ gap: "6px" }}>
          <input
            type="checkbox"
            checked={zone.enabled}
            disabled={busy}
            onChange={(e) =>
              mutate(
                () => call(`/api/admin/privacy/zones/${zone.id}`, "PATCH", { enabled: e.target.checked }),
                e.target.checked ? "zone enabled" : "zone disabled"
              )
            }
            style={{ width: "auto", accentColor: "var(--theme-text-primary)" }}
          />
          enabled
        </label>
        <div className="flex" style={{ gap: "12px" }}>
          <button className={smallBtn} disabled={busy} onClick={onSelect}>
            show
          </button>
          <button className={smallBtn} disabled={busy} onClick={onEditShape}>
            edit shape
          </button>
          <button
            className={smallBtn}
            disabled={busy}
            onClick={() => {
              if (!confirm("archive this zone? it stays in history and can be restored.")) return;
              mutate(() => call(`/api/admin/privacy/zones/${zone.id}`, "DELETE"), "zone archived");
            }}
          >
            archive
          </button>
        </div>
      </div>
      {history.length > 0 && (
        <div>
          <button className={smallBtn} onClick={() => setOpen(!open)}>
            {open ? "hide" : "show"} history ({history.length})
          </button>
          {open && <History versions={history} busy={busy} mutate={mutate} />}
        </div>
      )}
    </div>
  );
}

function History({ versions, busy, mutate }: { versions: ZoneVersion[]; busy: boolean; mutate: Mutate }) {
  return (
    <ul className="flex flex-col" style={{ gap: "4px", marginTop: "6px" }}>
      {versions.map((v) => (
        <li key={v.id} className="flex items-center justify-between font-sans text-gray text-sm" style={{ gap: "8px" }}>
          <span>
            {v.name || "unnamed"} · {(v.polygon[0]?.length ?? 1) - 1} pts · made {fmtDate(v.createdAt)}
            {v.archivedAt ? ` · archived ${fmtDate(v.archivedAt)}` : ""}
          </span>
          {v.archivedAt && (
            <button
              className={smallBtn}
              disabled={busy}
              onClick={() => mutate(() => call(`/api/admin/privacy/zones/${v.id}/restore`, "POST"), "version restored")}
            >
              restore
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

function RebuildPanel({ pending, setPending }: { pending: number | null; setPending(n: number): void }) {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("");
  const stopRef = useRef(false);

  async function run() {
    setRunning(true);
    stopRef.current = false;
    const failed: number[] = [];
    let done = 0;
    try {
      while (!stopRef.current) {
        const r = await call("/api/admin/privacy/rebuild", "POST", { excludeIds: failed });
        done += r.processed - r.failedIds.length;
        failed.push(...r.failedIds);
        setPending(r.remaining);
        setProgress(`rebuilt ${done}${failed.length ? `, ${failed.length} failed` : ""}`);
        // nothing left, or only failures left
        if (r.remaining === 0 || r.processed === 0) break;
      }
      if (stopRef.current) setProgress((p) => `${p} — stopped`);
    } catch (error) {
      setProgress(`rebuild failed: ${(error as Error).message}`);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="card-bg rounded-lg flex flex-col" style={{ padding: "12px", gap: "8px" }}>
      <div className="flex items-center justify-between">
        <span className="font-sans text-off-white text-sm">
          {pending === null ? "pending: …" : pending === 0 ? "all activities up to date" : `${pending} activities waiting to rebuild`}
        </span>
        {running ? (
          <button className={smallBtn} onClick={() => (stopRef.current = true)}>
            stop
          </button>
        ) : (
          <button className={smallBtn} disabled={pending === 0} onClick={run}>
            rebuild now
          </button>
        )}
      </div>
      <p className="font-sans text-gray text-sm">the scheduled import also rebuilds pending activities a batch at a time.</p>
      {progress && <p className="font-sans text-gray text-sm italic">{progress}</p>}
    </div>
  );
}

function SettingsForm({ initial, coarsenOptions, mutate }: { initial: Settings; coarsenOptions: number[]; mutate: Mutate }) {
  const [mode, setMode] = useState(initial.distance.mode);
  const [roundToM, setRoundToM] = useState(initial.distance.roundToM);
  const [coarsen, setCoarsen] = useState(initial.coarsenStartMin);
  const [trim, setTrim] = useState(initial.defaultTrimM);

  return (
    <div className="flex flex-col" style={{ gap: "10px" }}>
      <h2 className="font-sans font-bold text-off-white text-xl">privacy settings</h2>
      <label>
        distance of routes with fog
        <select value={mode} onChange={(e) => setMode(e.target.value as Settings["distance"]["mode"])} className="text-off-white" style={inputStyle}>
          <option value="include-rounded">include hidden part, rounded</option>
          <option value="include-exact">include hidden part, exact</option>
          <option value="visible-only">visible part only</option>
        </select>
      </label>
      {mode === "include-rounded" && (
        <label>
          round to (m)
          <input type="number" min={10} max={5000} step={10} value={roundToM} onChange={(e) => setRoundToM(Number(e.target.value))} className="text-off-white" style={inputStyle} />
        </label>
      )}
      <label>
        coarsen start time
        <select value={coarsen} onChange={(e) => setCoarsen(Number(e.target.value))} className="text-off-white" style={inputStyle}>
          {coarsenOptions.map((m) => (
            <option key={m} value={m}>
              {m === 0 ? "exact" : `to ${m} min`}
            </option>
          ))}
        </select>
      </label>
      <label>
        default trim at both ends (m, tracks without their own trim)
        <input type="number" min={0} max={5000} step={10} value={trim} onChange={(e) => setTrim(Number(e.target.value))} className="text-off-white" style={inputStyle} />
      </label>
      <button
        className={bigBtn}
        style={{ padding: "10px" }}
        onClick={() =>
          mutate(
            () =>
              call("/api/admin/privacy/settings", "POST", {
                distance: { mode, roundToM },
                coarsenStartMin: coarsen,
                defaultTrimM: trim,
              }),
            "settings saved — every activity will rebuild"
          )
        }
      >
        save settings
      </button>
    </div>
  );
}
