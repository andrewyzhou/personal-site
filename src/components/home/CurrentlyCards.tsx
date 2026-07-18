"use client";

import { useEffect, useRef, useState } from "react";
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

// one fetch shared between every instance on the page
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
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

// the bar-graph sound icon: animated when playing, frozen mid-song when stale.
// 5 bars, staggered non-monotonically so the wave feels organic; opacity-80
// matches the stroked svg icon set so all card icons share the palette.
function Equalizer({ playing, size = 16 }: { playing: boolean; size?: number }) {
  const delays = [0, 0.35, 0.15, 0.45, 0.25];
  const staticScale = [0.45, 0.8, 0.6, 0.95, 0.5];
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} className="shrink-0 opacity-80" aria-hidden>
      {[1, 4, 7, 10, 13].map((x, i) => (
        <rect
          key={x}
          className="eq-bar"
          x={x}
          y="2"
          width="2"
          height="12"
          rx="1"
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

// single-line text that scrolls like a transit billboard when it overflows
function ScrollText({ text }: { text: string }) {
  const outerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    const outer = outerRef.current;
    const inner = measureRef.current;
    if (outer && inner) setOverflows(inner.scrollWidth > outer.clientWidth + 1);
  }, [text]);

  return (
    <div ref={outerRef} className="flex-1 min-w-0 overflow-hidden whitespace-nowrap text-gray text-xs">
      {overflows ? (
        <div className="cc-marquee" style={{ animationDuration: `${Math.max(6, text.length * 0.3)}s` }}>
          <span>{text}</span>
          <span aria-hidden>{text}</span>
        </div>
      ) : (
        <span ref={measureRef}>{text}</span>
      )}
    </div>
  );
}

// sidebar row: icon left, billboard text middle, time / live pulse right
function MiniRow({
  icon,
  text,
  right,
  href,
}: {
  icon: React.ReactNode;
  text: string;
  right?: React.ReactNode;
  href?: string;
}) {
  const row = (
    <div className="flex items-center gap-2 w-full min-w-0">
      <span className="shrink-0 flex items-center text-off-white">{icon}</span>
      <ScrollText text={text} />
      {right != null && <span className="shrink-0 flex items-center text-gray text-xs">{right}</span>}
    </div>
  );
  return href ? (
    <Link href={href} className="block w-full min-w-0">
      {row}
    </Link>
  ) : (
    row
  );
}

// full-size card, kept for future use on content sections
function Card({ icon, line1, line2, href }: { icon: React.ReactNode; line1: string; line2?: string; href?: string }) {
  const inner = (
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
      <Link href={href} className="block min-w-0 card-bg-hover rounded-lg">
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

  const { track, activity, book } = data;

  if (variant === "mini") {
    return (
      <div className="flex flex-col gap-1.5 w-full animate-content-enter">
        {track && (
          <MiniRow
            icon={<Equalizer playing={track.isPlaying} size={12} />}
            text={`${track.title} · ${track.artist}`}
            right={track.isPlaying ? <span className="cc-live" /> : timeAgo(track.playedAt)}
          />
        )}
        {activity && (
          <MiniRow
            href={`/activities/${activity.id}`}
            icon={
              <Image
                src={`/icons/activities/${sportIcon(activity.type)}.svg`}
                alt=""
                width={12}
                height={12}
                className="shrink-0 opacity-80"
              />
            }
            text={sportLabel(activity.type)}
            right={timeAgo(activity.startDate)}
          />
        )}
        {book && (
          <MiniRow
            icon={<Image src="/icons/library.svg" alt="" width={12} height={12} className="shrink-0 opacity-80" />}
            text={`${book.title}${book.authors?.[0]?.name ? ` · ${book.authors[0].name}` : ""}`}
            right={<span className="cc-live" />}
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-stretch justify-center gap-3 animate-content-enter">
      {track && (
        <Card
          icon={
            <span className="text-off-white shrink-0">
              <Equalizer playing={track.isPlaying} size={18} />
            </span>
          }
          line1={track.title}
          line2={track.isPlaying ? `${track.artist} · now` : `${track.artist} · ${timeAgo(track.playedAt)} ago`}
        />
      )}
      {activity && (
        <Card
          href={`/activities/${activity.id}`}
          icon={
            <Image
              src={`/icons/activities/${sportIcon(activity.type)}.svg`}
              alt=""
              width={18}
              height={18}
              className="shrink-0 opacity-80"
            />
          }
          line1={sportLabel(activity.type)}
          line2={`${timeAgo(activity.startDate)} ago`}
        />
      )}
      {book && (
        <Card
          icon={<Image src="/icons/library.svg" alt="" width={18} height={18} className="shrink-0 opacity-80" />}
          line1={book.title}
          line2={book.authors?.[0]?.name ?? "reading"}
        />
      )}
    </div>
  );
}
