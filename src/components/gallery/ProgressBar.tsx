"use client";

interface Props {
  total: number;
  currentIndex: number;
  /** 0..1 fill of the current segment */
  currentFill: number;
}

export default function ProgressBar({ total, currentIndex, currentFill }: Props) {
  return (
    <div className="flex gap-1 w-full" aria-hidden>
      {Array.from({ length: total }, (_, i) => {
        const fill = i < currentIndex ? 1 : i === currentIndex ? currentFill : 0;
        return (
          <div key={i} className="flex-1 h-[2px] rounded-full overflow-hidden" style={{ backgroundColor: "var(--theme-divider)" }}>
            <div
              style={{
                height: "100%",
                width: `${fill * 100}%`,
                backgroundColor: "var(--theme-text-primary)",
                transition: i === currentIndex ? "none" : "width 0.15s linear",
              }}
            />
          </div>
        );
      })}
    </div>
  );
}
