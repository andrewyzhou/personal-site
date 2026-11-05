import { NextResponse } from "next/server";
import { bearerMatches } from "@/lib/lift/auth";
import { ExportTooLargeError, loadExportWorkouts, toExportJson, toWorkoutCsv } from "@/lib/lift/export";
import { liftTimezone, utcToLocal } from "@/lib/lift/time";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/lift/export?format=csv|json (default csv). owner only: either lift token works.
export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  if (!bearerMatches(auth, process.env.LIFT_APP_TOKEN) && !bearerMatches(auth, process.env.LIFT_INGEST_TOKEN)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const format = (new URL(request.url).searchParams.get("format") ?? "csv").toLowerCase();
  if (format !== "csv" && format !== "json") {
    return NextResponse.json({ ok: false, error: "format must be csv or json" }, { status: 400 });
  }

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
    return new Response(JSON.stringify(toExportJson(workouts, now, tz), null, 2), {
      headers: { ...headers, "content-type": "application/json; charset=utf-8" },
    });
  }
  return new Response(toWorkoutCsv(workouts), { headers: { ...headers, "content-type": "text/csv; charset=utf-8" } });
}
