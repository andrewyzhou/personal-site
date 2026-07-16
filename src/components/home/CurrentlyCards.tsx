"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { isSpotifyTrack, isStravaActivity, isLiteralBook } from "@/lib/validate";
import { sportIcon, sportLabel } from "@/lib/activity-format";

interface SpotifyTrack {
  isPlaying: boolean;
  title: string;
  artist: string;
  playedAt?: string;
}

interface LatestActivity {
  id: number;
  type: string;
  startDate: string;
}

interface LiteralBook {
  title: string;
  authors?: { id: string; name: string }[];
}

interface CurrentlyData {
  track: SpotifyTrack | null;
  activity: LatestActivity | null;
  book: LiteralBook | null;
}

// one fetch shared between the sidebar minis and the home cards
let currentlyPromise: Promise<CurrentlyData> | null = null;

async function fetchJson(url: string): Promise<unknown> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function loadCurrently(): Promise<CurrentlyData> {
  if (!currentlyPromise) {
    currentlyPromise = Promise.all([
      fetchJson("/api/spotify"),
      fetchJson("/api/activities/latest"),
      fetchJson("/api/literal"),
    ]).then(([track, activity, book]) => ({
      track: isSpotifyTrack(track) ? (track as SpotifyTrack) : null,
      activity: isStravaActivity(activity) ? (activity as LatestActivity) : null,
      book: isLiteralBook(book) ? (book as LiteralBook) : null,
    }));
  }
  return currentlyPromise;
}

function timeAgo(iso?: string): string {
  if (!iso) return "";
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// the bar-graph sound icon: animated when playing, frozen mid-song when stale
function Equalizer({ playing, size = 16 }: { playing: boolean; size?: number }) {
  const delays = [0, 0.22, 0.44];
  const staticScale = [0.55, 0.9, 0.4];
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} className="shrink-0" aria-hidden>
      {[2, 6.5, 11].map((x, i) => (
        <rect
          key={x}
          className="eq-bar"
          x={x}
          y="2"
          width="3"
          height="12"
          rx="1.5"
          fill="currentColor"
          style={
            playing
              ? { animation: `eq-bounce 1.1s ease-in-out ${delays[i]}s infinite` }
              : { transform: `scaleY(${staticScale[i]})` }
          }
        />
      ))}
    </svg>
  );
}

interface CardProps {
  icon: React.ReactNode;
  line1: string;
  line2?: string;
  href?: string;
  mini?: boolean;
}

function Card({ icon, line1, line2, href, mini }: CardProps) {
  const inner = mini ? (
    <div className="flex items-center gap-2 min-w-0">
      {icon}
      <span className="text-gray text-xs truncate">{line1}</span>
    </div>
  ) : (
    <div className="flex items-center gap-3 card-bg rounded-lg min-w-0" style={{ padding: "0.625rem 0.875rem" }}>
      {icon}
      <div className="min-w-0">
        <p className="text-off-white text-sm font-medium truncate">{line1}</p>
        {line2 && <p className="text-gray text-xs truncate">{line2}</p>}
      </div>
    </div>
  );
  if (href) {
    return (
      <Link href={href} className={mini ? "block min-w-0" : "block min-w-0 card-bg-hover rounded-lg"}>
        {inner}
      </Link>
    );
  }
  return inner;
}

export default function CurrentlyCards({ variant = "full" }: { variant?: "full" | "mini" }) {
  const [data, setData] = useState<CurrentlyData | null>(null);

  useEffect(() => {
    let alive = true;
    loadCurrently().then((d) => {
      if (alive) setData(d);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (!data || (!data.track && !data.activity && !data.book)) return null;

  const mini = variant === "mini";
  const iconSize = mini ? 14 : 18;
  const { track, activity, book } = data;

  const cards = (
    <>
      {track && (
        <Card
          mini={mini}
          icon={
            <span className="text-off-white shrink-0">
              <Equalizer playing={track.isPlaying} size={iconSize} />
            </span>
          }
          line1={mini ? track.title : track.title}
          line2={track.isPlaying ? `${track.artist} · now` : `${track.artist} · ${timeAgo(track.playedAt)}`}
        />
      )}
      {activity && (
        <Card
          mini={mini}
          href={`/activities/${activity.id}`}
          icon={
            <Image
              src={`/icons/activities/${sportIcon(activity.type)}.svg`}
              alt=""
              width={iconSize}
              height={iconSize}
              className="shrink-0 opacity-80"
            />
          }
          line1={mini ? `${sportLabel(activity.type)} · ${timeAgo(activity.startDate)}` : sportLabel(activity.type)}
          line2={timeAgo(activity.startDate)}
        />
      )}
      {book && (
        <Card
          mini={mini}
          icon={
            <Image
              src="/icons/library.svg"
              alt=""
              width={iconSize}
              height={iconSize}
              className="shrink-0 opacity-80"
            />
          }
          line1={book.title}
          line2={book.authors?.[0]?.name ?? "reading"}
        />
      )}
    </>
  );

  return mini ? (
    <div className="flex flex-col gap-2 animate-content-enter">{cards}</div>
  ) : (
    <div className="flex flex-wrap items-stretch justify-center gap-3 animate-content-enter">{cards}</div>
  );
}
