"use client";

import { useEffect, useState } from "react";
import { useSite } from "@/content/SiteProvider";
import { fillParts } from "@/content/site-types";
import { MONTHS } from "@/lib/figure";

// "this site was last deployed on … for commit …", from the latest commit
export default function DeployedLine({ className = "font-sans text-gray text-lg" }: { className?: string }) {
  const { github: copy } = useSite();
  const [commit, setCommit] = useState<{ sha: string; date: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/github")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d?.latestCommit) setCommit(d.latestCommit);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!commit) return null;
  const d = new Date(commit.date);
  const hours = d.getHours() % 12 || 12;
  const when = `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} at ${hours}:${String(d.getMinutes()).padStart(2, "0")} ${d.getHours() >= 12 ? "pm" : "am"}`;
  return (
    <p className={className} style={{ marginTop: "0.5rem" }}>
      {fillParts(copy.deployed, { date: when, sha: commit.sha })}
    </p>
  );
}
