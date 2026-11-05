import RouteThumb from "@/components/RouteThumb";

// loading state for the map: the theme surface with a faint static route, so
// there's never an empty box while maplibre and the first tiles load
export default function MapSkeleton({ polyline }: { polyline?: string | null }) {
  return (
    <div
      className="rounded-lg card-bg activity-map-skeleton"
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--theme-text-muted)",
        opacity: 1,
      }}
    >
      {polyline && (
        <div style={{ opacity: 0.35 }}>
          <RouteThumb polyline={polyline} height={160} strokeWidth={1.5} />
        </div>
      )}
    </div>
  );
}

// the map's box (also used before the map code has loaded)
export function MapFrame({ children }: { children?: React.ReactNode }) {
  return (
    <div className="rounded-lg overflow-hidden" style={{ position: "relative", width: "100%", aspectRatio: "16/10", minHeight: 260 }}>
      {children}
    </div>
  );
}
