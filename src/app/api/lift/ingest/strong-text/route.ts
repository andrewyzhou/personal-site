import { NextResponse } from "next/server";
import { ingestStrongText, type IngestResult } from "@/lib/lift/ingest";
import type { IngestSource } from "@/lib/lift/plan";
import { bearerMatches } from "@/lib/lift/auth";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// route modules may only export next's known names, so this stays private
const MAX_BODY_BYTES = 64 * 1024;

class TooLarge extends Error {}

// reads at most `limit` bytes so a missing/lying content-length can't make us buffer more
async function readCapped(request: Request, limit: number): Promise<string> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) throw new TooLarge();
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new TooLarge();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

const CLIENT_SOURCES: readonly IngestSource[] = ["shortcut", "api"];

// shortcuts can send the share sheet as a plain-text file, json, or a form
function parseBody(raw: string, contentType: string): { text: string; source: IngestSource } | null {
  const ct = contentType.toLowerCase();
  const looksJson = ct.includes("json") || (!ct.includes("text/plain") && raw.trimStart().startsWith("{"));
  if (looksJson) {
    try {
      const body = JSON.parse(raw) as { text?: unknown; source?: unknown };
      if (typeof body?.text !== "string") return null;
      const source = CLIENT_SOURCES.includes(body.source as IngestSource) ? (body.source as IngestSource) : "api";
      return { text: body.text, source };
    } catch {
      return null;
    }
  }
  if (ct.includes("application/x-www-form-urlencoded")) {
    const text = new URLSearchParams(raw).get("text");
    return text == null ? null : { text, source: "shortcut" };
  }
  return { text: raw, source: "shortcut" };
}

function respond(result: IngestResult): NextResponse {
  const base = {
    ingestId: result.ingestId,
    workoutId: result.workoutId,
    summary: result.summary,
    // one line for the shortcut's notification; details is the full breakdown
    text: result.text,
    details: result.details,
    warnings: result.warnings,
    links: result.links,
  };
  if (result.status === "empty") {
    return NextResponse.json({ ok: false, error: result.text, ...base }, { status: 422 });
  }
  if (result.status === "duplicate") {
    return NextResponse.json({ ok: true, duplicate: true, updated: false, ...base }, { status: 200 });
  }
  if (result.status === "updated") {
    return NextResponse.json({ ok: true, duplicate: false, updated: true, ...base }, { status: 200 });
  }
  return NextResponse.json({ ok: true, duplicate: false, updated: false, ...base }, { status: 201 });
}

export async function POST(request: Request) {
  if (!bearerMatches(request.headers.get("authorization"), process.env.LIFT_INGEST_TOKEN)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let raw: string;
  try {
    raw = await readCapped(request, MAX_BODY_BYTES);
  } catch (error) {
    if (error instanceof TooLarge) {
      return NextResponse.json({ ok: false, error: "body too large (max 64kb)" }, { status: 413 });
    }
    return NextResponse.json({ ok: false, error: "could not read body" }, { status: 400 });
  }

  const body = parseBody(raw, request.headers.get("content-type") ?? "");
  if (!body) {
    return NextResponse.json({ ok: false, error: "expected text, or json {text}" }, { status: 400 });
  }
  if (!body.text.trim()) {
    return NextResponse.json({ ok: false, error: "empty text" }, { status: 400 });
  }

  try {
    return respond(await ingestStrongText(body.text, { source: body.source }));
  } catch (error) {
    log.error("api:lift/ingest", "ingest failed", error);
    return NextResponse.json({ ok: false, error: "ingest failed" }, { status: 500 });
  }
}
