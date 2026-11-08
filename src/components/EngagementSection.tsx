"use client";

import { useEffect, useRef, useState } from "react";

// public claps + view count for blog posts, photosets, and activities.
// degrades quietly: if the api is down the section renders nothing noisy and
// the page content is unaffected.

interface Summary {
  claps: number;
  views: number;
}

export default function EngagementSection({ target }: { target: string }) {
  const [data, setData] = useState<Summary | null>(null);
  const [failed, setFailed] = useState(false);
  const pendingClaps = useRef(0);
  const clapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/engagement?target=${encodeURIComponent(target)}`)
      .then(async (res) => {
        const payload = await res.json().catch(() => null);
        if (!cancelled) {
          if (payload?.data) setData(payload.data);
          else setFailed(true);
        }
      })
      .catch(() => !cancelled && setFailed(true));

    // count a view once per session
    try {
      const key = `viewed:${target}`;
      if (!sessionStorage.getItem(key)) {
        sessionStorage.setItem(key, "1");
        fetch("/api/engagement/views", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ target }),
        }).catch(() => {});
      }
    } catch {
      // sessionStorage unavailable — skip counting
    }

    return () => {
      cancelled = true;
    };
  }, [target]);

  if (failed || !data) return null;

  function clap() {
    if (!data) return;
    setData({ ...data, claps: data.claps + 1 });
    pendingClaps.current += 1;
    if (clapTimer.current) clearTimeout(clapTimer.current);
    clapTimer.current = setTimeout(() => {
      const pending = pendingClaps.current;
      pendingClaps.current = 0;
      if (pending > 0) {
        fetch("/api/engagement/claps", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ target, count: pending }),
        }).catch(() => {});
      }
    }, 800);
  }

  return (
    <section style={{ marginTop: "3rem" }}>
      <div className="flex items-center" style={{ gap: "16px" }}>
        <button onClick={clap} className="font-sans text-gray text-sm link-highlight" aria-label="clap">
          👏 {data.claps > 0 ? data.claps : ""}
        </button>
        <span className="font-sans text-gray text-xs" style={{ marginLeft: "auto" }}>
          {data.views > 0 ? `${data.views} view${data.views === 1 ? "" : "s"}` : ""}
        </span>
      </div>
    </section>
  );
}
