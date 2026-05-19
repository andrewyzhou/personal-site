import type { LearningType } from "@/lib/learning";

interface Props {
  type: LearningType;
  size?: number;
  className?: string;
}

export default function SourceIcon({ type, size = 18, className = "" }: Props) {
  const stroke = "#EEEEEE";
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke,
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className,
    "aria-label": type,
  };

  switch (type) {
    case "book":
      return (
        <svg {...common}>
          <path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17H6.5A2.5 2.5 0 0 0 4 21.5z" />
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        </svg>
      );
    case "video":
      return (
        <svg {...common}>
          <polygon points="6,4 20,12 6,20" />
        </svg>
      );
    case "podcast":
      return (
        <svg {...common}>
          <rect x="9" y="3" width="6" height="12" rx="3" />
          <path d="M5 11a7 7 0 0 0 14 0" />
          <line x1="12" y1="18" x2="12" y2="22" />
          <line x1="9" y1="22" x2="15" y2="22" />
        </svg>
      );
    case "course":
      return (
        <svg {...common}>
          <path d="M2 9l10-5 10 5-10 5z" />
          <path d="M6 11v5c0 1.5 3 3 6 3s6-1.5 6-3v-5" />
        </svg>
      );
    case "article":
      return (
        <svg {...common}>
          <path d="M5 3h11l4 4v14H5z" />
          <line x1="8" y1="9" x2="14" y2="9" />
          <line x1="8" y1="13" x2="17" y2="13" />
          <line x1="8" y1="17" x2="17" y2="17" />
        </svg>
      );
  }
}
