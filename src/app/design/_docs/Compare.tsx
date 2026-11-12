"use client";

import { useEffect, useRef, useState } from "react";
import { Chip, Cluster, Stack, Text } from "@/design-system";

// a page in an iframe at its true device width, scaled to fit its column
export function Frame({ src, width, title }: { src: string; width: number; title: string }) {
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
      <Text size="xs" tone="subtle">
        {title}
      </Text>
      <div ref={box} style={{ width: "100%", height: height * scale, overflow: "hidden", borderRadius: "var(--ds-radius-lg)", border: "1px solid var(--ds-border)" }}>
        <iframe src={src} title={title} width={width} height={height} style={{ border: 0, transform: `scale(${scale})`, transformOrigin: "0 0", display: "block" }} />
      </div>
    </Stack>
  );
}

function useTheme() {
  return useState<"light" | "dark">("dark");
}

function ThemeChips({ theme, setTheme }: { theme: string; setTheme: (t: "light" | "dark") => void }) {
  return (
    <Cluster gap="2">
      <Chip selected={theme === "light"} onClick={() => setTheme("light")}>
        light
      </Chip>
      <Chip selected={theme === "dark"} onClick={() => setTheme("dark")}>
        dark
      </Chip>
    </Cluster>
  );
}

// one pattern in one brand: desktop and phone side by side
export function PatternPreview({ brand, path }: { brand: string; path: string }) {
  const [theme, setTheme] = useTheme();
  const src = `/design/preview/${brand}${path}?theme=${theme}`;
  return (
    <Stack gap="4">
      <ThemeChips theme={theme} setTheme={setTheme} />
      <div style={{ display: "grid", gap: "var(--ds-space-5)", gridTemplateColumns: "minmax(0, 3fr) minmax(0, 1fr)" }} className="docs-preview-row">
        <Frame key={`d-${src}`} src={src} width={1440} title="desktop · 1440" />
        <Frame key={`m-${src}`} src={src} width={390} title="phone · 390" />
      </div>
      <a href={src} target="_blank" rel="noreferrer" className="ds-link" data-variant="standalone">
        open full page ↗
      </a>
    </Stack>
  );
}

const PAGES = [
  { id: "/training/464", label: "activity" },
  { id: "/training/496", label: "lift session" },
  { id: "/training", label: "training" },
  { id: "", label: "home" },
  { id: "/writing/sample-post", label: "article" },
];

// every brand on the same page
export function BrandCompare({ brands }: { brands: { id: string; name: string }[] }) {
  const [page, setPage] = useState(PAGES[0].id);
  const [width, setWidth] = useState(1440);
  const [theme, setTheme] = useTheme();
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
          <Chip selected={width === 1440} onClick={() => setWidth(1440)}>
            desktop
          </Chip>
          <Chip selected={width === 390} onClick={() => setWidth(390)}>
            phone
          </Chip>
          <ThemeChips theme={theme} setTheme={setTheme} />
        </Cluster>
      </Stack>
      <div style={{ display: "grid", gap: "var(--ds-space-6)", gridTemplateColumns: width === 390 ? "repeat(auto-fit, minmax(12rem, 1fr))" : "minmax(0, 1fr)" }}>
        {brands.map((b) => (
          <Frame key={`${b.id}-${page}-${width}-${theme}`} title={`${b.id.toUpperCase()} · ${b.name}`} width={width} src={`/design/preview/${b.id}${page}?theme=${theme}`} />
        ))}
      </div>
    </Stack>
  );
}
