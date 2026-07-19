"use client";

import { useEffect, useRef } from "react";

// ipad-pointer-style cursor: a soft translucent circle that replaces the
// native cursor (fine pointers only — untouched on touch devices). grows
// slightly over interactive elements. styles + knobs in globals.css.
export default function CursorHalo() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // only hide the native cursor once js is live, so no-js keeps a cursor
    document.body.classList.add("cursor-halo");

    const move = (e: MouseEvent) => {
      el.style.transform = `translate3d(${e.clientX}px, ${e.clientY}px, 0) translate(-50%, -50%)`;
      const interactive = (e.target as Element | null)?.closest?.(
        "a, button, [role='button'], input, textarea, select, label, summary"
      );
      el.classList.toggle("cursor-halo--active", !!interactive);
      el.classList.add("cursor-halo--visible");
    };
    const hide = () => el.classList.remove("cursor-halo--visible");

    window.addEventListener("mousemove", move, { passive: true });
    document.documentElement.addEventListener("mouseleave", hide);
    window.addEventListener("blur", hide);
    return () => {
      document.body.classList.remove("cursor-halo");
      window.removeEventListener("mousemove", move);
      document.documentElement.removeEventListener("mouseleave", hide);
      window.removeEventListener("blur", hide);
    };
  }, []);

  return <div ref={ref} className="cursor-halo-dot" aria-hidden />;
}
