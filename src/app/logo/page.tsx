"use client";

import { useState } from "react";
import GoldenLogo from "@/components/home/GoldenLogo";

// dev tuning page: both logo layouts side by side, dots force-shown.
// knobs live at the top of src/components/home/GoldenLogo.tsx.
export default function LogoPreview() {
  const [run, setRun] = useState(0);
  return (
    <main
      className="min-h-dvh flex flex-wrap items-center justify-center"
      style={{ padding: "3rem", gap: "5rem" }}
    >
      <button
        onClick={() => setRun((n) => n + 1)}
        className="text-gray hover:text-off-white text-sm cursor-pointer"
        style={{ position: "fixed", top: "1rem", right: "1.25rem" }}
      >
        ↻ replay draw
      </button>
      {/* key remounts the logos so the draw-on animation restarts */}
      <div key={run} className="contents">
        <div className="flex flex-col items-center" style={{ gap: "1.25rem", width: "36rem", maxWidth: "90vw" }}>
          <GoldenLogo layout="horizontal" className="w-full gl-show-dots" />
          <p className="text-gray text-sm">horizontal — curve starts bottom right</p>
        </div>
        {/* 36rem x 610/987 — exact transpose of the horizontal, so both render at identical scale */}
        <div className="flex flex-col items-center" style={{ gap: "1.25rem", width: "22.25rem", maxWidth: "70vw" }}>
          <GoldenLogo layout="vertical" className="w-full gl-show-dots" />
          <p className="text-gray text-sm">vertical — curve starts top left</p>
        </div>
      </div>
    </main>
  );
}
