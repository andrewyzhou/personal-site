"use client";

// optional sort element for the shared list template: any tab can opt in by
// rendering it above its list. additive — no existing rows are restyled.
export interface SortOption {
  id: string;
  label: string;
}

export default function SortControl({
  options,
  value,
  onChange,
}: {
  options: SortOption[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="flex items-center" style={{ gap: "8px", marginBottom: "1rem" }}>
      <span className="font-sans text-gray text-sm">sort:</span>
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={`font-sans text-sm ${value === o.id ? "text-off-white link-highlight-active" : "text-gray link-highlight"}`}
          style={{ padding: "1px 6px" }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
