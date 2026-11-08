// read-only: every distinct activity type in the owner's intervals.icu history
// and what the site maps it to. intervals' `type` (+ trainer flag) for every
// activity, and the fit file's sport / sub_sport for those with a fit original
// (downloaded into memory only, never stored).
//
//   npx tsx --env-file=.env.local scripts/intervals-type-report.mts [--oldest 2015-01-01] [--no-files] [--json out.json]
//
// no writes anywhere: intervals reads (list + /file) and nothing else.

import fs from "node:fs";
import { Decoder, Stream } from "@garmin/fitsdk";
import { unwrapTrackFile } from "../src/lib/fit";
import { downloadOriginal, listActivities } from "../src/lib/intervals";
import { fitSportType, intervalsSportType, isKnownFitSport } from "../src/lib/sport-map";
import { isSportType, sportFamily, sportTypeIcon } from "../src/lib/sport-types";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const oldest = arg("oldest") ?? "2015-01-01";
const withFiles = !process.argv.includes("--no-files");
const jsonOut = arg("json");

if (!process.env.INTERVALS_ICU_API_KEY) {
  console.error("INTERVALS_ICU_API_KEY is not set");
  process.exit(1);
}

const listed = await listActivities(oldest);
console.log(`${listed.length} activities since ${oldest} (stubs from other services excluded)`);

type Row = { key: string; count: number; mapsTo: string; family: string; icon: string; known: boolean };
const intervalsCounts = new Map<string, Row>();
const fitCounts = new Map<string, Row>();
const sources = new Map<string, number>();
let fitFiles = 0;
let otherFiles = 0;
let noFile = 0;

const bump = (m: Map<string, Row>, key: string, mapsTo: string, known: boolean) => {
  const row = m.get(key) ?? { key, count: 0, mapsTo, family: sportFamily(mapsTo), icon: sportTypeIcon(mapsTo), known };
  row.count++;
  m.set(key, row);
};

for (const [i, a] of listed.entries()) {
  sources.set(a.source ?? "?", (sources.get(a.source ?? "?") ?? 0) + 1);
  const t = intervalsSportType(a.type, a.trainer);
  bump(intervalsCounts, `${a.type ?? "(none)"}${a.trainer ? " +trainer" : ""}`, t, !!a.type && (isSportType(a.type) || a.type === "Other"));
  if (!withFiles) continue;
  try {
    const bytes = await downloadOriginal(a.id);
    if (!bytes) {
      noFile++;
      continue;
    }
    const inner = unwrapTrackFile(bytes, `${a.id}.${a.file_type || "fit"}`);
    if (inner.fileType !== "fit") {
      otherFiles++;
      continue;
    }
    fitFiles++;
    const { messages } = new Decoder(Stream.fromByteArray(inner.bytes)).read();
    const s = (messages.sessionMesgs?.[0] ?? {}) as { sport?: unknown; subSport?: unknown };
    const sport = s.sport === undefined ? "(none)" : String(s.sport);
    const sub = s.subSport === undefined ? "(none)" : String(s.subSport);
    bump(fitCounts, `${sport} / ${sub}`, fitSportType(sport, sub), isKnownFitSport(sport));
  } catch (error) {
    console.warn(`  ${a.id}: ${(error as Error).message}`);
  }
  if ((i + 1) % 50 === 0) console.log(`  …${i + 1}/${listed.length}`);
}

const print = (title: string, m: Map<string, Row>) => {
  console.log(`\n${title}`);
  const rows = [...m.values()].sort((a, b) => b.count - a.count);
  for (const r of rows) console.log(`  ${String(r.count).padStart(4)}  ${r.key.padEnd(36)} → ${r.mapsTo.padEnd(30)} ${r.family.padEnd(10)} ${r.icon}${r.known ? "" : "  (UNKNOWN UPSTREAM VALUE)"}`);
  return rows;
};

console.log(`\nsources: ${[...sources].map(([k, v]) => `${k} ${v}`).join(", ")}`);
const intervalsRows = print("intervals type (+trainer) → site type", intervalsCounts);
const fitRows = withFiles ? print(`fit sport / sub_sport → site type (${fitFiles} fit files, ${otherFiles} gpx/tcx, ${noFile} without a file)`, fitCounts) : [];
const unknown = [...intervalsRows, ...fitRows].filter((r) => !r.known);
console.log(`\n${unknown.length === 0 ? "every upstream value is mapped explicitly" : `${unknown.length} unmapped upstream values`}`);

if (jsonOut) {
  fs.writeFileSync(jsonOut, JSON.stringify({ oldest, total: listed.length, sources: Object.fromEntries(sources), fitFiles, otherFiles, noFile, intervals: intervalsRows, fit: fitRows }, null, 2));
  console.log(`wrote ${jsonOut}`);
}
