"use client";

import { useEffect, useRef } from "react";

// ipad-pointer-style cursor: a soft translucent circle that replaces the
// native cursor (fine pointers only — untouched on touch devices). the halo
// lags the pointer slightly and smears along its direction of travel
// (motion blur); shaking the mouse triggers the same emphasized state as
// hovering a link, so a lost cursor is easy to find. css knobs (sizes,
// strengths) live in globals.css under CURSOR HALO.

// ── motion knobs ─────────────────────────────────────────────────────
const FOLLOW = 0.35; // lerp per frame: lower = more lag + longer smear
const STRETCH = 0.04; // elongation per px of per-frame travel
const MAX_STRETCH = 2.4; // cap on the smear
// ── shake-to-find knobs ──────────────────────────────────────────────
const SHAKE_REVERSALS = 4; // horizontal direction flips that count as a shake
const SHAKE_WINDOW = 700; // ms window the flips must land in
const SHAKE_MIN_SEG = 40; // px each swing must travel to count
const SHAKE_HOLD = 900; // ms the emphasized state lingers after a shake

const INTERACTIVE = "a, button, [role='button'], input, textarea, select, label, summary";

export default function CursorHalo() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // only hide the native cursor once js is live, so no-js keeps a cursor
    document.body.classList.add("cursor-halo");

    // pointer target vs rendered (lerped) position
    let tx = -100;
    let ty = -100;
    let px = -100;
    let py = -100;
    let started = false;
    let hoverBig = false;

    // shake detection: count large horizontal direction reversals
    let lastX = 0;
    let lastDir = 0;
    let segLen = 0;
    let flips: number[] = [];
    let shakeUntil = 0;

    const onMove = (e: MouseEvent) => {
      if (!started) {
        // first event: snap into place instead of flying in from a corner
        px = e.clientX;
        py = e.clientY;
        lastX = e.clientX;
        started = true;
      }
      tx = e.clientX;
      ty = e.clientY;
      el.classList.add("cursor-halo--visible");
      hoverBig = !!(e.target as Element | null)?.closest?.(INTERACTIVE);

      const dx = e.clientX - lastX;
      const dir = Math.sign(dx);
      if (dir !== 0) {
        if (dir === lastDir || lastDir === 0) {
          segLen += Math.abs(dx);
        } else {
          if (segLen >= SHAKE_MIN_SEG) {
            const now = performance.now();
            flips = [...flips.filter((t) => now - t < SHAKE_WINDOW), now];
            if (flips.length >= SHAKE_REVERSALS) shakeUntil = now + SHAKE_HOLD;
          }
          segLen = Math.abs(dx);
        }
        lastDir = dir;
      }
      lastX = e.clientX;
    };

    const hide = () => el.classList.remove("cursor-halo--visible");

    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const dx = tx - px;
      const dy = ty - py;
      px += dx * FOLLOW;
      py += dy * FOLLOW;
      // smear along the motion vector, preserving visual mass
      const step = Math.hypot(dx, dy) * FOLLOW;
      const stretch = Math.min(1 + step * STRETCH, MAX_STRETCH);
      const angle = stretch > 1.02 ? Math.atan2(dy, dx) : 0;
      el.style.transform =
        `translate3d(${px}px, ${py}px, 0) translate(-50%, -50%) ` +
        `rotate(${angle}rad) scale(${stretch}, ${1 / Math.sqrt(stretch)})`;
      el.classList.toggle("cursor-halo--big", hoverBig || performance.now() < shakeUntil);
    };
    raf = requestAnimationFrame(tick);

    window.addEventListener("mousemove", onMove, { passive: true });
    document.documentElement.addEventListener("mouseleave", hide);
    window.addEventListener("blur", hide);
    return () => {
      cancelAnimationFrame(raf);
      document.body.classList.remove("cursor-halo");
      window.removeEventListener("mousemove", onMove);
      document.documentElement.removeEventListener("mouseleave", hide);
      window.removeEventListener("blur", hide);
    };
  }, []);

  return <div ref={ref} className="cursor-halo-dot" aria-hidden />;
}
