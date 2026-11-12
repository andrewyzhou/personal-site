import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

// label + control + hint/error. the caller passes the control's id so this
// stays a server component (no hooks).
export function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="ds-field">
      <label className="ds-field-label" htmlFor={id}>
        {label}
      </label>
      {children}
      {error ? (
        <span id={`${id}-error`} className="ds-field-error">
          {error}
        </span>
      ) : hint ? (
        <span id={`${id}-hint`} className="ds-field-hint">
          {hint}
        </span>
      ) : null}
    </div>
  );
}

export function Input({ invalid, ...rest }: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return <input className="ds-input" aria-invalid={invalid || undefined} {...rest} />;
}

export function Textarea({ invalid, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return <textarea className="ds-input" aria-invalid={invalid || undefined} {...rest} />;
}

export function Select({ invalid, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }) {
  return (
    <select className="ds-input ds-select" aria-invalid={invalid || undefined} {...rest}>
      {children}
    </select>
  );
}

export function Checkbox({ label, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { label: ReactNode }) {
  return (
    <label className="ds-check">
      <input type="checkbox" {...rest} />
      <span>{label}</span>
    </label>
  );
}
