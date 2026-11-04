// read-only: run the cleaning detectors over activities' canonical tracks,
// built exactly as republish builds them, and print what they would suggest.
// never writes anything (selects + raw reads only).
//
//   npx tsx --env-file=.env.local scripts/detect-cleaning.mts [--ids 1,2,3] [--quiet] [--profile] [--concurrency 6]
//
// --quiet: only activities with actionable suggestions; --profile: per-minute track dump

import { asc, inArray } from "drizzle-orm";
import { getDb } from "../src/lib/db";
import { activities, activitySources, type ActivityRow } from "../src/lib/db/schema";
import { buildTrack, loadRawBytes, trackCandidates, type RepublishDeps, type SourceInput } from "../src/lib/republish";
import { detectSuggestions, formatDuration } from "../src/lib/cleaning/detect";
import { validateCleaningEdit } from "../src/lib/cleaning/edits";
import type { Suggestion } from "../src/lib/cleaning/types";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const quiet = process.argv.includes("--quiet");
const profile = process.argv.includes("--profile");
const concurrency = Math.max(1, Number(arg("concurrency") ?? 6));
const idsArg = arg("ids");
const onlyIds = idsArg ? idsArg.split(",").map((s) => Number(s.trim())).filter(Number.isFinite) : null;
const AUTO_APPLY = 0.9;

const db = getDb();
// only legacy columns: prod may be behind the schema
const cols = {
  id: activities.id,
  name: activities.name,
  sportType: activities.sportType,
  startDateUtc: activities.startDateUtc,
  fileType: activities.fileType,
  fitSha256: activities.fitSha256,
  fitBlobPathname: activities.fitBlobPathname,
};
const rows = await (onlyIds
  ? db.select(cols).from(activities).where(inArray(activities.id, onlyIds)).orderBy(asc(activities.id))
  : db.select(cols).from(activities).orderBy(asc(activities.id)));
const sourceRows = await db
  .select({
    activityId: activitySources.activityId,
    id: activitySources.id,
    kind: activitySources.kind,
    provider: activitySources.provider,
    externalId: activitySources.externalId,
    rawSha256: activitySources.rawSha256,
  })
  .from(activitySources)
  .orderBy(asc(activitySources.id));
const sourcesById = new Map<number, SourceInput[]>();
for (const { activityId, ...s } of sourceRows) {
  if (!sourcesById.has(activityId)) sourcesById.set(activityId, []);
  sourcesById.get(activityId)!.push(s);
}

// buildTrack only reads raw bytes through deps.loadRaw
const deps = { loadRaw: loadRawBytes } as unknown as RepublishDeps;

const fmtRange = (r: Suggestion["range"]) => (r ? `${formatDuration(r.fromS)} to ${formatDuration(r.toS)}` : "-");

interface Outcome {
  id: number;
  line: string;
  status: "ok" | "no-track" | "unavailable" | "error";
  sport: string;
  samples: number;
  ms: number;
  suggestions: Suggestion[];
}

async function one(row: (typeof rows)[number]): Promise<Outcome> {
  const base = { id: row.id, sport: row.sportType, samples: 0, ms: 0, suggestions: [] as Suggestion[] };
  const line = `#${row.id} ${row.sportType} ${row.startDateUtc.toISOString().slice(0, 10)} "${row.name}"`;
  const candidates = trackCandidates(sourcesById.get(row.id) ?? []);
  try {
    for (const ref of candidates) {
      const track = await buildTrack(ref, row as unknown as ActivityRow, deps);
      if (track === "unavailable") return { ...base, line: `${line} [${ref.kind} unavailable]`, status: "unavailable" };
      if (!track) continue;
      const t0 = performance.now();
      const suggestions = detectSuggestions(track, row.sportType);
      const ms = performance.now() - t0;
      for (const s of suggestions) {
        if (s.edit && !validateCleaningEdit(s.edit.kind, s.edit.params).ok) throw new Error(`invalid edit ${JSON.stringify(s.edit)}`);
      }
      const n = track.columns.t.length;
      const dur = n ? track.columns.t[n - 1] : 0;
      if (profile) {
        // per-minute profile: samples, distance, mean device speed, max step
        const c = track.columns;
        for (let m = 0, i = 0; m * 60 <= dur; m++) {
          let k = 0, sp = 0, spn = 0, maxDt = 0, hr = 0, hrn = 0;
          const d0 = c.dist[i];
          for (; i < n && c.t[i] < (m + 1) * 60; i++, k++) {
            if (c.speed[i] !== null) { sp += c.speed[i]!; spn++; }
            if (c.hr[i] !== null) { hr += c.hr[i]!; hrn++; }
            if (i > 0) maxDt = Math.max(maxDt, c.t[i] - c.t[i - 1]);
          }
          const d1 = c.dist[Math.max(0, i - 1)];
          console.log(`  min ${m}: ${k} samples, ${Math.round(d1 - d0)} m, dev ${spn ? (sp / spn).toFixed(2) : "-"} m/s, max dt ${maxDt}, hr ${hrn ? Math.round(hr / hrn) : "-"}, pos ${c.lat[Math.max(0, i - 1)] !== null}`);
        }
      }
      return {
        ...base,
        line: `${line} [${ref.kind}${track.source.fileType ? `/${track.source.fileType}` : ""}, ${n} samples, ${formatDuration(dur)}]`,
        status: "ok",
        samples: n,
        ms,
        suggestions,
      };
    }
    const kinds = (sourcesById.get(row.id) ?? []).map((s) => `${s.kind}${s.rawSha256 ? "" : "(no raw)"}`);
    return { ...base, line: `${line} [no track; sources: ${kinds.join(", ") || "none"}]`, status: "no-track" };
  } catch (error) {
    return { ...base, line: `${line} [error: ${(error as Error).message}]`, status: "error" };
  }
}

const queue = [...rows];
const outcomes: Outcome[] = [];
await Promise.all(
  Array.from({ length: concurrency }, async () => {
    for (let row = queue.shift(); row; row = queue.shift()) outcomes.push(await one(row));
  })
);
outcomes.sort((a, b) => a.id - b.id);

const byKind = new Map<string, { n: number; auto: number; activities: Set<number> }>();
let autoTotal = 0;
let slowest = { id: 0, ms: 0, samples: 0 };
for (const o of outcomes) {
  if (o.ms > slowest.ms) slowest = { id: o.id, ms: o.ms, samples: o.samples };
  const interesting = o.suggestions.filter((s) => s.kind !== "idle" || s.edit);
  if (o.status !== "ok" || interesting.length || (!quiet && o.suggestions.length)) {
    if (!quiet || o.status !== "ok" || interesting.length) console.log(o.line);
    for (const s of quiet ? interesting : o.suggestions) {
      const auto = s.edit && s.confidence >= AUTO_APPLY ? " AUTO" : "";
      console.log(`    ${s.kind.padEnd(11)} ${s.confidence.toFixed(2)}${auto}  ${s.summary}  [${fmtRange(s.range)}]${s.edit ? ` ${s.edit.kind} ${JSON.stringify(s.edit.params).slice(0, 80)}` : ""}`);
    }
    if (quiet) {
      const idles = o.suggestions.filter((s) => s.kind === "idle" && !s.edit).length;
      if (idles && interesting.length) console.log(`    (+${idles} idle info)`);
    }
  }
  for (const s of o.suggestions) {
    const k = byKind.get(s.kind) ?? { n: 0, auto: 0, activities: new Set<number>() };
    k.n++;
    k.activities.add(o.id);
    if (s.edit && s.confidence >= AUTO_APPLY) {
      k.auto++;
      autoTotal++;
    }
    byKind.set(s.kind, k);
  }
}

const count = (st: Outcome["status"]) => outcomes.filter((o) => o.status === st).length;
console.log("\nsummary");
console.log(`  activities: ${outcomes.length} (${count("ok")} with a track, ${count("no-track")} without, ${count("unavailable")} raw unavailable, ${count("error")} errors)`);
for (const [kind, k] of [...byKind.entries()].sort()) {
  console.log(`  ${kind.padEnd(11)} ${String(k.n).padStart(5)} suggestions on ${String(k.activities.size).padStart(4)} activities, ${k.auto} would auto-apply at ${AUTO_APPLY}`);
}
console.log(`  would auto-apply at ${AUTO_APPLY}: ${autoTotal}`);
console.log(`  slowest detection: #${slowest.id} ${slowest.ms.toFixed(1)} ms (${slowest.samples} samples)`);
