import { NextResponse } from "next/server";
import { bearerMatches } from "@/lib/lift/auth";
import { ExportTooLargeError, chunkStream, exportJsonChunks, loadExportWorkouts, strongCsvLines } from "@/lib/lift/export";
import { liftTimezone, utcToLocal } from "@/lib/lift/time";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/lift/export?format=csv|json (default csv). owner only: the app token.
// not the ingest token: that one lives in a shortcut and only needs to write.
export async function GET(request: Request) {
  if (!bearerMatches(request.headers.get("authorization"), process.env.LIFT_APP_TOKEN)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const format = (new URL(request.url).searchParams.get("format") ?? "csv").toLowerCase();
  if (format !== "csv" && format !== "json") {
    return NextResponse.json({ ok: false, error: "format must be csv or json" }, { status: 400 });
  }

  // loaded (and size-checked) before the first byte, so a 413 or 500 is still a real status
  let workouts;
  try {
    workouts = await loadExportWorkouts();
  } catch (error) {
    if (error instanceof ExportTooLargeError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 413 });
    }
    log.error("api:lift/export", "export failed", error);
    return NextResponse.json({ ok: false, error: "export failed" }, { status: 500 });
  }

  const now = new Date();
  const tz = liftTimezone();
  const filename = `lifts-${utcToLocal(now, tz).slice(0, 10)}.${format}`;
  const headers = {
    "content-disposition": `attachment; filename="${filename}"`,
    // personal data: never cached anywhere
    "cache-control": "no-store",
  };
  if (format === "json") {
    return new Response(chunkStream(exportJsonChunks(workouts, now, tz)), {
      headers: { ...headers, "content-type": "application/json; charset=utf-8" },
    });
  }
  return new Response(chunkStream(strongCsvLines(workouts)), { headers: { ...headers, "content-type": "text/csv; charset=utf-8" } });
}
