"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ListeningOverview, RecentPlay } from "@/lib/listening/admin-data";
import type { ListeningRunStats } from "@/lib/db/listening-schema";

export interface ListeningAdminData {
  configured: boolean;
  migrated: boolean;
  error: string | null;
  state: {
    cursorPlayedAt: string | null;
    lastRunAt: string | null;
    lastRunStatus: string | null;
    lastError: string | null;
    lastSuccessAt: string | null;
    lastRunStats: ListeningRunStats | null;
  } | null;
  counts: ListeningOverview["counts"];
  recent: RecentPlay[];
  lastImport: ListeningOverview["lastImport"];
}

interface SyncResult extends Partial<ListeningRunStats> {
  ok: boolean;
  error?: string;
  dryRun?: boolean;
  repo?: string;
  preview?: RecentPlay[];
}

const bigBtn = "card-bg rounded-lg font-sans text-off-white text-sm";
const label = "font-sans text-gray text-xs";
const value = "font-sans text-off-white text-sm";

const fmtTime = (s: string | null) => (s ? new Date(s).toLocaleString() : "never");

function ago(s: string | null): string {
  if (!s) return "";
  const min = Math.round((Date.now() - new Date(s).getTime()) / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}

function fmtDuration(ms: number | null, estimated: boolean): string {
  if (ms === null) return "—";
  const s = Math.round(ms / 1000);
  const t = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  return estimated ? `~${t}` : t;
}

const SOURCE_LABEL: Record<string, string> = { "api-recent": "api", "export-extended": "export", "export-basic": "basic" };

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between" style={{ gap: "12px", padding: "3px 0" }}>
      <span className={label}>{k}</span>
      <span className={value} style={{ textAlign: "right" }}>
        {v}
      </span>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card-bg rounded-lg" style={{ padding: "14px 16px", marginBottom: "12px" }}>
      <h2 className="font-sans font-bold text-off-white text-base" style={{ marginBottom: "6px" }}>
        {title}
      </h2>
      {children}
    </section>
  );
}

function PlaysTable({ plays }: { plays: RecentPlay[] }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="font-sans text-sm" style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr className="text-gray text-xs" style={{ textAlign: "left" }}>
            <th style={{ padding: "4px 6px 4px 0", fontWeight: 400 }}>played</th>
            <th style={{ padding: "4px 6px", fontWeight: 400 }}>track</th>
            <th style={{ padding: "4px 0 4px 6px", fontWeight: 400, textAlign: "right" }}>time</th>
          </tr>
        </thead>
        <tbody>
          {plays.map((p) => (
            <tr key={`${p.id}-${p.playedAt}`} style={{ borderTop: "1px solid var(--theme-highlight-bg)" }}>
              <td className="text-gray text-xs" style={{ padding: "6px 6px 6px 0", whiteSpace: "nowrap", verticalAlign: "top" }}>
                {new Date(p.playedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
              </td>
              <td style={{ padding: "6px", verticalAlign: "top" }}>
                <div className="text-off-white">{p.title ?? "(unknown)"}</div>
                <div className="text-gray text-xs">
                  {p.artist ?? ""}
                  {p.itemType !== "track" ? ` · ${p.itemType}` : ""} · {SOURCE_LABEL[p.source] ?? p.source}
                  {p.skipped ? " · skipped" : ""}
                </div>
              </td>
              <td
                className="text-gray text-xs"
                style={{ padding: "6px 0 6px 6px", textAlign: "right", whiteSpace: "nowrap", verticalAlign: "top" }}
                title={p.msPlayedEstimated ? "estimated from the gap to the previous play" : "exact"}
              >
                {fmtDuration(p.msPlayed, p.msPlayedEstimated)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ListeningAdmin({ data }: { data: ListeningAdminData }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"sync" | "dry" | null>(null);
  const [result, setResult] = useState<SyncResult | null>(null);

  async function sync(dryRun: boolean) {
    setBusy(dryRun ? "dry" : "sync");
    setResult(null);
    try {
      const res = await fetch("/api/admin/listening/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun }),
      });
      const json = (await res.json().catch(() => null)) as SyncResult | null;
      setResult(json ?? { ok: false, error: `request failed (${res.status})` });
      if (!dryRun && json?.ok) router.refresh();
    } catch (error) {
      setResult({ ok: false, error: (error as Error).message });
    } finally {
      setBusy(null);
    }
  }

  const s = data.state;
  const stats = s?.lastRunStats;
  const imp = data.lastImport?.summary as
    | { plays?: number; inserted?: number; mergedWithApi?: number; alreadyImported?: number; range?: { from: string | null; to: string | null }; unknownFields?: Record<string, number> }
    | undefined;

  return (
    <div>
      <h1 className="font-sans font-bold text-off-white text-2xl" style={{ marginBottom: "4px" }}>
        listening
      </h1>
      <p className="font-sans text-gray text-sm" style={{ marginBottom: "14px" }}>
        everything played on spotify, collected every 15 minutes and stored raw.
      </p>

      <p
        className="font-sans text-gray text-xs rounded-lg"
        style={{ padding: "10px 12px", marginBottom: "12px", border: "1px solid var(--theme-highlight-bg)" }}
      >
        private by default: the listening log and the raw responses behind it are only visible here. public stats
        (later) need an explicit opt-in per stat; nothing is published until one is turned on.
      </p>

      {data.error && (
        <p className="font-sans text-sm" style={{ color: "#e5484d", marginBottom: "12px" }}>
          could not load: {data.error}
        </p>
      )}
      {!data.configured && (
        <p className="font-sans text-gray text-sm italic" style={{ marginBottom: "12px" }}>
          spotify is not configured (SPOTIFY_CLIENT_ID / _SECRET / _REFRESH_TOKEN).
        </p>
      )}
      {!data.migrated && !data.error && (
        <p className="font-sans text-gray text-sm italic" style={{ marginBottom: "12px" }}>
          the listening tables don&apos;t exist yet: the migration hasn&apos;t been applied. sync now will fail until
          then; a dry run calls spotify and shows what would be stored.
        </p>
      )}

      <Card title="sync">
        <Row
          k="last run"
          v={
            s?.lastRunAt ? (
              <span title={fmtTime(s.lastRunAt)}>
                {ago(s.lastRunAt)} · {s.lastRunStatus === "ok" ? "ok" : <span style={{ color: "#e5484d" }}>{s.lastRunStatus}</span>}
              </span>
            ) : (
              "never"
            )
          }
        />
        {s?.lastError && <Row k="error" v={<span style={{ color: "#e5484d" }}>{s.lastError}</span>} />}
        <Row k="last success" v={s?.lastSuccessAt ? ago(s.lastSuccessAt) : "never"} />
        <Row k="cursor" v={fmtTime(s?.cursorPlayedAt ?? null)} />
        {stats && (
          <Row
            k="last run did"
            v={`${stats.inserted} new · ${stats.merged} merged · ${stats.duplicates} seen · ${stats.metadata.artists + stats.metadata.albums} lookups${stats.possibleGap ? " · possible gap" : ""}`}
          />
        )}
        <div className="flex" style={{ gap: "8px", marginTop: "10px" }}>
          <button
            type="button"
            className={bigBtn}
            style={{ padding: "8px 14px", flex: 1, opacity: busy ? 0.6 : 1 }}
            disabled={busy !== null || !data.configured}
            onClick={() => sync(false)}
          >
            {busy === "sync" ? "syncing…" : "sync now"}
          </button>
          <button
            type="button"
            className="font-sans text-gray text-sm link-highlight rounded-lg"
            style={{ padding: "8px 14px", border: "1px solid var(--theme-highlight-bg)", opacity: busy ? 0.6 : 1 }}
            disabled={busy !== null || !data.configured}
            onClick={() => sync(true)}
          >
            {busy === "dry" ? "checking…" : "dry run"}
          </button>
        </div>
        {result && (
          <p className="font-sans text-sm" style={{ marginTop: "10px", color: result.ok ? undefined : "#e5484d" }} role="status">
            {result.ok
              ? `${result.dryRun ? "dry run: would add" : "added"} ${result.inserted ?? 0} plays (${result.merged ?? 0} merged, ${result.duplicates ?? 0} already stored) from ${result.pages ?? 0} page${result.pages === 1 ? "" : "s"}${result.possibleGap ? " · possible gap since the last run" : ""}${result.dryRun ? " · nothing was written" : ""}`
              : `failed: ${result.error}`}
          </p>
        )}
      </Card>

      {data.counts && (
        <Card title="log">
          <Row k="plays" v={data.counts.plays.toLocaleString()} />
          <Row
            k="by source"
            v={
              Object.entries(data.counts.bySource)
                .map(([k, n]) => `${SOURCE_LABEL[k] ?? k} ${n.toLocaleString()}`)
                .join(" · ") || "—"
            }
          />
          <Row k="estimated durations" v={data.counts.estimated.toLocaleString()} />
          <Row k="hours" v={data.counts.hours.toLocaleString()} />
          <Row k="range" v={data.counts.first ? `${new Date(data.counts.first).toLocaleDateString()} → ${new Date(data.counts.last!).toLocaleDateString()}` : "—"} />
          <Row
            k="metadata"
            v={`${data.counts.tracks} tracks · ${data.counts.artists} artists${data.counts.artistsIncomplete ? ` (${data.counts.artistsIncomplete} pending)` : ""} · ${data.counts.albums} albums`}
          />
        </Card>
      )}

      <Card title="export import">
        {data.lastImport && imp ? (
          <>
            <Row k="imported" v={`${ago(data.lastImport.createdAt)} · ${data.lastImport.filename ?? ""}`} />
            <Row k="plays" v={`${imp.plays ?? 0} (${imp.inserted ?? 0} new, ${imp.mergedWithApi ?? 0} merged, ${imp.alreadyImported ?? 0} already in)`} />
            {imp.range?.from && (
              <Row k="range" v={`${new Date(imp.range.from).toLocaleDateString()} → ${new Date(imp.range.to!).toLocaleDateString()}`} />
            )}
            {imp.unknownFields && Object.keys(imp.unknownFields).length > 0 && (
              <Row k="unknown fields" v={Object.keys(imp.unknownFields).join(", ")} />
            )}
          </>
        ) : (
          <p className="font-sans text-gray text-sm">
            no export imported yet. when the extended streaming history arrives, run{" "}
            <code className="text-xs">scripts/import-spotify-export.mts --zip &lt;path&gt;</code> (dry run first, then{" "}
            <code className="text-xs">--apply</code>).
          </p>
        )}
      </Card>

      {result?.preview && result.preview.length > 0 && (
        <Card title="dry run: plays a sync would store">
          <PlaysTable plays={result.preview} />
        </Card>
      )}

      <Card title="recent plays">
        {data.recent.length > 0 ? <PlaysTable plays={data.recent} /> : <p className="font-sans text-gray text-sm">no plays stored yet.</p>}
      </Card>
    </div>
  );
}
