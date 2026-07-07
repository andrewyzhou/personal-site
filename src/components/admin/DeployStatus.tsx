"use client";

import { useEffect, useState } from "react";

// post-commit build feedback: polls the deploy status written by vercel's
// github integration. purely additive — polling failure never affects editing.
export default function DeployStatus({ commitSha, commitUrl }: { commitSha: string; commitUrl: string }) {
  const [state, setState] = useState<string>("pending");
  const [targetUrl, setTargetUrl] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;
    const startedAt = Date.now();

    async function poll() {
      if (stopped) return;
      if (Date.now() - startedAt > 5 * 60_000) {
        setState("unknown");
        return;
      }
      try {
        const res = await fetch(`/api/admin/deploy-status?sha=${commitSha}`);
        const body = await res.json();
        if (!stopped && body?.data) {
          setState(body.data.state);
          setTargetUrl(body.data.targetUrl);
          if (["success", "failure", "error"].includes(body.data.state)) return;
        }
      } catch {
        // keep polling quietly
      }
      setTimeout(poll, 10_000);
    }
    poll();
    return () => {
      stopped = true;
    };
  }, [commitSha]);

  const short = commitSha.slice(0, 7);

  if (state === "success") {
    return (
      <span className="font-sans text-gray text-xs">
        committed {short} — live
        {targetUrl && (
          <>
            {" "}
            <a href={targetUrl} target="_blank" rel="noopener noreferrer" className="link-highlight">view →</a>
          </>
        )}
      </span>
    );
  }
  if (state === "failure" || state === "error") {
    return (
      <span className="font-sans text-gray text-xs">
        committed {short} — build failed
        {targetUrl && (
          <>
            {" "}
            <a href={targetUrl} target="_blank" rel="noopener noreferrer" className="link-highlight">view on vercel →</a>
          </>
        )}
      </span>
    );
  }
  if (state === "unknown") {
    return (
      <a href={commitUrl} target="_blank" rel="noopener noreferrer" className="font-sans text-gray text-xs link-highlight">
        committed {short} →
      </a>
    );
  }
  return (
    <span className="font-sans text-gray text-xs animate-pulse">
      committed {short} — rebuilding (~1–2 min)
    </span>
  );
}
