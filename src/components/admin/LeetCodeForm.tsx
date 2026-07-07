"use client";

import { useState } from "react";
import { TextField, NumberField, SelectField, TextareaField, Field } from "./fields";
import DeployStatus from "./DeployStatus";

const LANGUAGES = ["python", "java", "cpp", "c", "javascript", "typescript", "go", "rust", "sql"];
const EXT: Record<string, string> = {
  python: "py", java: "java", cpp: "cpp", c: "c",
  javascript: "js", typescript: "ts", go: "go", rust: "rs", sql: "sql",
};

function kebab(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export default function LeetCodeForm() {
  const [url, setUrl] = useState("");
  const [lookupState, setLookupState] = useState<"idle" | "loading" | "error">("idle");
  const [lookupMessage, setLookupMessage] = useState("");
  const [number, setNumber] = useState<number | "">("");
  const [title, setTitle] = useState("");
  const [difficulty, setDifficulty] = useState<"Easy" | "Medium" | "Hard">("Medium");
  const [language, setLanguage] = useState("python");
  const [pathTouched, setPathTouched] = useState(false);
  const [path, setPath] = useState("");
  const [code, setCode] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [done, setDone] = useState<{ commitSha: string; commitUrl: string; path: string } | null>(null);

  const autoPath =
    number !== "" && title
      ? `${String(number).padStart(4, "0")}-${kebab(title)}.${EXT[language]}`
      : "";
  const effectivePath = pathTouched ? path : autoPath;
  const commitPreview = number !== "" && title ? `${number}. ${title} (${difficulty})` : "";

  async function autofill(u: string) {
    setLookupState("loading");
    setLookupMessage("");
    try {
      const res = await fetch(`/api/admin/leetcode/lookup?url=${encodeURIComponent(u)}`);
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.data) {
        setLookupState("error");
        setLookupMessage(body?.error?.message ?? "lookup failed — fill fields manually");
        return;
      }
      setNumber(body.data.number);
      setTitle(body.data.title);
      setDifficulty(body.data.difficulty);
      setLookupState("idle");
    } catch {
      setLookupState("error");
      setLookupMessage("lookup unavailable — fill fields manually");
    }
  }

  async function save() {
    setSaving(true);
    setMessage("");
    try {
      const res = await fetch("/api/admin/leetcode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ number, title, difficulty, language, code, path: effectivePath }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.data) {
        if (res.status === 409 && body?.error?.details?.path) {
          setPathTouched(true);
          setPath(String(body.error.details.path).replace(/(\.[a-z0-9]+)$/i, "-2$1"));
          setMessage("a file already exists at that path — suffix applied, save again");
        } else {
          setMessage(body?.error?.message ?? "save failed");
        }
        return;
      }
      setDone(body.data);
    } catch {
      setMessage("save failed — check your connection");
    } finally {
      setSaving(false);
    }
  }

  if (done) {
    return (
      <div className="admin-cms flex flex-col" style={{ gap: "10px" }}>
        <p className="font-sans text-off-white text-lg">committed {done.path}</p>
        <p className="font-sans text-gray text-sm">the activity calendar will update shortly.</p>
        <DeployStatus commitSha={done.commitSha} commitUrl={done.commitUrl} />
        <a href={done.commitUrl} target="_blank" rel="noopener noreferrer" className="font-sans text-gray text-sm link-highlight">
          view commit →
        </a>
        <button
          onClick={() => {
            setDone(null); setUrl(""); setNumber(""); setTitle(""); setCode(""); setPathTouched(false); setPath("");
          }}
          className="font-sans text-gray text-sm link-highlight"
          style={{ alignSelf: "flex-start" }}
        >
          add another
        </button>
      </div>
    );
  }

  return (
    <div className="admin-cms flex flex-col" style={{ gap: "12px" }}>
      <Field label="problem url (autofills number/title/difficulty)" error={lookupState === "error" ? lookupMessage : undefined}>
        <div className="flex" style={{ gap: "8px" }}>
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onPaste={(e) => {
              const pasted = e.clipboardData.getData("text");
              if (pasted.includes("leetcode.com/problems/")) autofill(pasted);
            }}
            placeholder="https://leetcode.com/problems/two-sum/"
            style={{ flex: 1 }}
          />
          <button
            onClick={() => autofill(url)}
            disabled={lookupState === "loading" || !url}
            className="font-sans text-gray text-sm link-highlight rounded"
            style={{ padding: "4px 10px", flexShrink: 0 }}
          >
            {lookupState === "loading" ? "looking up…" : "autofill"}
          </button>
        </div>
      </Field>

      <div className="flex" style={{ gap: "8px" }}>
        <NumberField label="number" value={number} onChange={(v) => setNumber(v)} min={1} />
        <div style={{ flex: 1 }}>
          <TextField label="title" value={title} onChange={setTitle} />
        </div>
      </div>

      <Field label="difficulty">
        <div className="flex" style={{ gap: "6px" }}>
          {(["Easy", "Medium", "Hard"] as const).map((d) => (
            <button
              key={d}
              onClick={() => setDifficulty(d)}
              className={`font-sans text-sm ${difficulty === d ? "text-off-white link-highlight-active" : "text-gray link-highlight"}`}
              style={{ padding: "2px 8px" }}
            >
              {d.toLowerCase()}
            </button>
          ))}
        </div>
      </Field>

      <SelectField label="language" value={language} onChange={setLanguage} options={LANGUAGES.map((l) => ({ value: l, label: l }))} />
      <TextField
        label="path in leetcode repo"
        value={effectivePath}
        onChange={(v) => {
          setPathTouched(true);
          setPath(v);
        }}
        mono
      />
      <TextareaField label="solution code" value={code} onChange={setCode} rows={14} mono placeholder="paste your solution" />

      {commitPreview && (
        <p className="font-sans text-gray text-xs" style={{ fontFamily: "ui-monospace, monospace" }}>
          commit: {commitPreview}
        </p>
      )}
      {message && <p className="font-sans text-gray text-sm italic">⚠ {message}</p>}

      <button
        onClick={save}
        disabled={saving || number === "" || !title || !code.trim()}
        className="card-bg rounded-lg font-sans text-off-white text-lg"
        style={{ padding: "12px" }}
      >
        {saving ? "committing…" : "commit solution"}
      </button>
    </div>
  );
}
