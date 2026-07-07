"use client";

import { useState } from "react";

// controlled field primitives for the cms forms. styling comes from
// admin.css's scoped input/textarea/select rules.

export function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col" style={{ gap: "4px" }}>
      <label className="font-sans">{label}</label>
      {children}
      {error && <span className="field-error">⚠ {error}</span>}
    </div>
  );
}

export function TextField({
  label, value, onChange, placeholder, error, mono, disabled,
}: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; error?: string; mono?: boolean; disabled?: boolean;
}) {
  return (
    <Field label={label} error={error}>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        style={mono ? { fontFamily: "ui-monospace, monospace" } : undefined}
      />
    </Field>
  );
}

export function DateField({ label, value, onChange, error }: {
  label: string; value: string; onChange: (v: string) => void; error?: string;
}) {
  return (
    <Field label={label} error={error}>
      <input type="date" value={value} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

export function TextareaField({ label, value, onChange, rows = 3, error, mono, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; rows?: number; error?: string; mono?: boolean; placeholder?: string;
}) {
  return (
    <Field label={label} error={error}>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        placeholder={placeholder}
        style={mono ? { fontFamily: "ui-monospace, monospace" } : undefined}
      />
    </Field>
  );
}

export function SelectField({ label, value, onChange, options, error }: {
  label: string; value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[]; error?: string;
}) {
  return (
    <Field label={label} error={error}>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </Field>
  );
}

export function NumberField({ label, value, onChange, step = 1, min, max, error }: {
  label: string; value: number | ""; onChange: (v: number | "") => void;
  step?: number; min?: number; max?: number; error?: string;
}) {
  return (
    <Field label={label} error={error}>
      <input
        type="number"
        value={value}
        step={step}
        min={min}
        max={max}
        onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
      />
    </Field>
  );
}

export function CheckboxField({ label, checked, onChange }: {
  label: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <label className="font-sans flex items-center" style={{ gap: "8px", fontSize: "0.875rem", color: "var(--theme-text-muted)" }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ width: "auto", accentColor: "var(--theme-text-primary)" }}
      />
      {label}
    </label>
  );
}

export function TagInput({ label, value, onChange, error }: {
  label: string; value: string[]; onChange: (v: string[]) => void; error?: string;
}) {
  const [draft, setDraft] = useState("");

  const commit = () => {
    const tag = draft.trim().toLowerCase();
    if (tag && !value.includes(tag)) onChange([...value, tag]);
    setDraft("");
  };

  return (
    <Field label={label} error={error}>
      <div className="flex flex-wrap items-center" style={{ gap: "6px" }}>
        {value.map((tag) => (
          <span key={tag} className="font-sans text-gray link-highlight rounded" style={{ fontSize: "0.75rem", padding: "2px 6px" }}>
            {tag}{" "}
            <button type="button" onClick={() => onChange(value.filter((t) => t !== tag))} aria-label={`remove ${tag}`}>
              ×
            </button>
          </span>
        ))}
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              commit();
            }
          }}
          onBlur={commit}
          placeholder="add tag ⏎"
          style={{ width: "120px", flexShrink: 0 }}
        />
      </div>
    </Field>
  );
}
