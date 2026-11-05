"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { ReplayData } from "@/lib/replay/build";
import type { ActivityMapPhoto } from "./ActivityMap3D";
import ActivityCharts from "./ActivityCharts";
import MapSkeleton, { MapFrame } from "./MapSkeleton";

// maplibre and the map component load only once the section is near the
// viewport, so the page's first paint never waits on them
const ActivityMap3D = dynamic(() => import("./ActivityMap3D"), {
  ssr: false,
  loading: () => <MapPlaceholder />,
});

// the loading slot gets no props, so the skeleton's route comes by context
const SkeletonRoute = createContext<string | null>(null);

function MapPlaceholder() {
  const polyline = useContext(SkeletonRoute);
  return (
    <MapFrame>
      <MapSkeleton polyline={polyline} />
    </MapFrame>
  );
}

interface ActivityMapSectionProps {
  activityId: number;
  polyline: string;
  bounds: { minLat: number; minLng: number; maxLat: number; maxLng: number };
  fogShapes: number[][][][] | null;
  photos: ActivityMapPhoto[];
  sportType: string;
}

type ReplayState = { status: "idle" | "loading" | "none" } | { status: "ready"; replay: ReplayData };

// map + charts sharing one hover time. the replay is fetched when the section
// nears the viewport; a 404 (or any failure) leaves the polyline-only map and
// no charts.
export default function ActivityMapSection({ activityId, polyline, bounds, fogShapes, photos, sportType }: ActivityMapSectionProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const [state, setState] = useState<ReplayState>({ status: "idle" });
  const [hoverT, setHoverT] = useState<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true);
          io.disconnect();
        }
      },
      { rootMargin: "400px 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!near) return;
    const ctrl = new AbortController();
    setState({ status: "loading" });
    fetch(`/api/activities/${activityId}/replay`, { signal: ctrl.signal })
      .then(async (res) => {
        if (!res.ok) return setState({ status: "none" });
        const body = (await res.json()) as { replay: ReplayData | null };
        const r = body.replay;
        setState(r && Array.isArray(r.segments) && r.segments.length > 0 ? { status: "ready", replay: r } : { status: "none" });
      })
      .catch(() => {
        if (!ctrl.signal.aborted) setState({ status: "none" });
      });
    return () => ctrl.abort();
  }, [near, activityId]);

  const replay = state.status === "ready" ? state.replay : null;

  return (
    <SkeletonRoute.Provider value={polyline}>
    <div ref={ref}>
      {near ? (
        <ActivityMap3D
          polyline={polyline}
          bounds={bounds}
          fogShapes={fogShapes}
          replay={replay}
          sportType={sportType}
          photos={photos}
          hoverT={hoverT}
          onHoverT={setHoverT}
        />
      ) : (
        <MapPlaceholder />
      )}
      {replay && <ActivityCharts replay={replay} sportType={sportType} hoverT={hoverT} onHoverT={setHoverT} />}
    </div>
    </SkeletonRoute.Provider>
  );
}
