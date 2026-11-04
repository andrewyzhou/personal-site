"use client";

import { useEffect, useState } from "react";
import { formToSettings, settingsToForm, zoneBpm, type SettingsForm } from "@/lib/cleaning/ui-format";
import { getActivitySettings, saveActivitySettings } from "./api";

const inputStyle: React.CSSProperties = {
  padding: "4px 8px",
  border: "1px solid var(--theme-highlight-bg)",
  backgroundColor: "var(--theme-card-bg)",
  borderRadius: "8px",
  width: "5rem",
};

// global cleaning/metrics settings: auto-apply threshold, max hr, zone bounds
export default function SettingsPanel({ onSaved }: { onSaved(): void }) {
  const [form, setForm] = useState<SettingsForm | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    getActivitySettings()
      .then((s) => setForm(settingsToForm(s)))
      .catch((e: Error) => setMessage(e.message));
  }, []);

  async function save() {
    if (!form) return;
    const parsed = formToSettings(form);
    if (!parsed.ok) {
      setMessage(parsed.error);
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const s = await saveActivitySettings(parsed.settings);
      setForm(settingsToForm(s ?? parsed.settings));
      setMessage("saved");
      onSaved();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!form) return <p className="font-sans text-gray text-sm italic">{message || "loading settings…"}</p>;
  const hr = Number(form.hrMaxBpm);
  const bpm = Number.isFinite(hr) ? zoneBpm(hr, form.zonePcts.map((p) => Number(p) / 100)) : [];

  return (
    <div className="flex flex-col" style={{ gap: "8px" }}>
      <label className="font-sans text-gray text-sm flex items-center" style={{ gap: "8px" }}>
        <input
          type="checkbox"
          checked={form.enabled}
          onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
          style={{ accentColor: "var(--theme-text-primary)" }}
        />
        auto-apply suggestions at or above
        <input
          type="number"
          min={50}
          max={100}
          value={form.minConfidencePct}
          onChange={(e) => setForm({ ...form, minConfidencePct: e.target.value })}
          className="font-sans text-off-white text-sm"
          style={inputStyle}
        />
        % confidence
      </label>
      <label className="font-sans text-gray text-sm flex items-center" style={{ gap: "8px" }}>
        max hr
        <input
          type="number"
          min={120}
          max={230}
          value={form.hrMaxBpm}
          onChange={(e) => setForm({ ...form, hrMaxBpm: e.target.value })}
          className="font-sans text-off-white text-sm"
          style={inputStyle}
        />
        bpm
      </label>
      <div className="font-sans text-gray text-sm flex flex-wrap items-center" style={{ gap: "8px" }}>
        zone bounds (% of max)
        {form.zonePcts.map((p, i) => (
          <input
            key={i}
            type="number"
            min={31}
            max={99}
            value={p}
            aria-label={`zone ${i + 1}/${i + 2} bound`}
            onChange={(e) => setForm({ ...form, zonePcts: form.zonePcts.map((x, j) => (j === i ? e.target.value : x)) })}
            className="font-sans text-off-white text-sm"
            style={{ ...inputStyle, width: "4rem" }}
          />
        ))}
      </div>
      {bpm.length === 4 && bpm.every(Number.isFinite) && (
        <p className="font-sans text-gray text-xs">
          z1 &lt; {bpm[0]} · z2 {bpm[0]}–{bpm[1]} · z3 {bpm[1]}–{bpm[2]} · z4 {bpm[2]}–{bpm[3]} · z5 ≥ {bpm[3]} bpm
        </p>
      )}
      <div className="flex items-center" style={{ gap: "12px" }}>
        <button className="card-bg rounded-lg font-sans text-off-white text-sm" style={{ padding: "6px 12px" }} disabled={busy} onClick={save}>
          {busy ? "saving…" : "save settings"}
        </button>
        {message && <span className="font-sans text-gray text-sm italic">{message}</span>}
      </div>
    </div>
  );
}
