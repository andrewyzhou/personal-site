"use client";

import { useEffect, useRef, useState } from "react";
import { Chip, Cluster, Stack, Text } from "@/design-system";

const PAGES = [
  { id: "activities/464", label: "activity (hike)" },
  { id: "activities/496", label: "activity (lift)" },
  { id: "activities", label: "activities" },
  { id: "", label: "home" },
];
const WIDTHS = [
  { id: 1440, label: "desktop 1440" },
  { id: 390, label: "phone 390" },
];

// one direction in a frame at true device width, scaled to fit its column
function Frame({ src, width, title }: { src: string; width: number; title: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.3);
  const height = width === 390 ? 844 : 900;
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScale(Math.min(1, el.clientWidth / width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [width]);
  return (
    <Stack gap="2">
      <Text size="sm" tone="fg" weight="medium">
        {title}
      </Text>
      <div ref={box} style={{ width: "100%", height: height * scale, overflow: "hidden", borderRadius: 12, border: "1px solid var(--ds-border)" }}>
        <iframe
          src={src}
          title={title}
          width={width}
          height={height}
          style={{ border: 0, transform: `scale(${scale})`, transformOrigin: "0 0", display: "block" }}
        />
      </div>
    </Stack>
  );
}

export function Compare({ directions }: { directions: { id: string; name: string }[] }) {
  const [page, setPage] = useState(PAGES[0].id);
  const [width, setWidth] = useState(1440);
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  return (
    <Stack gap="6">
      <Stack gap="3">
        <Cluster gap="2">
          {PAGES.map((p) => (
            <Chip key={p.id} selected={page === p.id} onClick={() => setPage(p.id)}>
              {p.label}
            </Chip>
          ))}
        </Cluster>
        <Cluster gap="2">
          {WIDTHS.map((w) => (
            <Chip key={w.id} selected={width === w.id} onClick={() => setWidth(w.id)}>
              {w.label}
            </Chip>
          ))}
          <Chip selected={theme === "light"} onClick={() => setTheme("light")}>
            light
          </Chip>
          <Chip selected={theme === "dark"} onClick={() => setTheme("dark")}>
            dark
          </Chip>
        </Cluster>
      </Stack>
      <div style={{ display: "grid", gap: 24, gridTemplateColumns: width === 390 ? "repeat(auto-fit, minmax(240px, 1fr))" : "1fr" }}>
        {directions.map((d) => (
          <Frame
            key={`${d.id}-${page}-${width}-${theme}`}
            title={d.name}
            width={width}
            src={`/design-system/preview/${d.id}${page ? "/" + page : ""}?theme=${theme}`}
          />
        ))}
      </div>
    </Stack>
  );
}
