// import a spotify data export (extended streaming history and/or the basic
// account data zip) into listening_plays.
//
//   npx tsx --env-file=.env.local scripts/import-spotify-export.mts \
//     --zip ~/Downloads/my_spotify_data.zip [--apply] [--verbose]
//
// dry run by default: parses the zip, reads neon (when the listening tables
// exist) and prints what would happen; nothing is written. --apply stores the
// whole zip and every history file byte-for-byte in the private raw store,
// merges export rows onto api rows for the same play (the export wins for
// ms_played / skips), inserts the rest and records an import summary.
// idempotent: a re-run of the same zip inserts nothing.

import fs from "node:fs";
import path from "node:path";
import { unzipSync } from "fflate";
import { getRawStore, isRawStoreConfigured, sha256Hex } from "../src/lib/raw-store";
import { importExport, parseExportEntries, type ImportRaw } from "../src/lib/listening/export-import";
import { createMemoryRepo, readOnlyRepo, type ListeningRepo } from "../src/lib/listening/repo";
import { dbListeningRepo, listeningTablesExist } from "../src/lib/listening/repo-db";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string) => process.argv.includes(`--${name}`);

const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
const zipArg = arg("zip");
if (!zipArg) {
  console.error("usage: import-spotify-export.mts --zip <path> [--apply] [--verbose]");
  process.exit(1);
}
const zipPath = zipArg.replace(/^~/, home);
const apply = has("apply");
const verbose = has("verbose");

console.log(`export: ${zipPath}${apply ? "" : " (dry run, nothing is written)"}`);
const zipBytes = new Uint8Array(fs.readFileSync(zipPath));
const entries = Object.entries(unzipSync(zipBytes)).map(([p, bytes]) => ({ path: p, bytes }));
const parsed = parseExportEntries(entries);

let repo: ListeningRepo;
let repoKind: string;
const tables = process.env.DATABASE_URL ? await listeningTablesExist().catch(() => false) : false;
if (apply) {
  if (!tables) throw new Error("listening tables do not exist yet: apply the migration first");
  if (!isRawStoreConfigured()) throw new Error("R2_RAW_BUCKET is not set");
  repo = dbListeningRepo();
  repoKind = "neon";
} else if (tables) {
  repo = readOnlyRepo(dbListeningRepo());
  repoKind = "neon (read-only)";
} else {
  repo = createMemoryRepo();
  repoKind = "empty in-memory (listening tables not migrated yet)";
}
console.log(`database: ${repoKind}`);

const rawLog: string[] = [];
const raw: ImportRaw = apply
  ? {
      async put(bytes, o) {
        const r = await getRawStore().put(bytes, o);
        rawLog.push(`${r.created ? "stored" : "already stored"} ${o.kind} ${o.filename} ${r.sha256.slice(0, 12)}`);
        return r.sha256;
      },
    }
  : {
      async put(bytes, o) {
        const sha = sha256Hex(bytes);
        rawLog.push(`would store ${o.kind} ${o.filename} ${sha.slice(0, 12)} (${bytes.length} B)`);
        return sha;
      },
    };

const s = await importExport({ zipBytes, zipFilename: path.basename(zipPath), parsed, repo, raw, dryRun: !apply });

const mb = (n: number) => `${(n / 1e6).toFixed(1)} MB`;
console.log(`zip: ${s.zip.sha256.slice(0, 12)}… ${mb(s.zip.size)}, ${s.files.length} files`);
for (const f of s.files.filter((f) => f.kind !== "other")) console.log(`  ${f.kind.padEnd(8)} ${f.path} (${f.rows} rows)`);
const others = s.files.filter((f) => f.kind === "other");
if (others.length) console.log(`  + ${others.length} other files (kept inside the raw zip only)${verbose ? ": " + others.map((f) => f.path).join(", ") : ""}`);
console.log(`plays: ${s.plays} (extended ${s.byKind.extended}, basic ${s.byKind.basic}), ${(s.msPlayed / 3.6e6).toFixed(1)} h`);
console.log(`range: ${s.range.from ?? "—"} → ${s.range.to ?? "—"}`);
console.log(
  `${apply ? "" : "would: "}insert ${s.inserted}, merge with api rows ${s.mergedWithApi}, already imported ${s.alreadyImported}, re-estimate ${s.reestimated}`
);
console.log(`skipped: ${s.invalidRows} invalid rows, ${s.duplicateRows} duplicate rows, ${s.redundantBasic} basic rows covered by the extended history`);
const unknown = Object.entries(s.unknownFields);
console.log(unknown.length ? `unknown fields: ${unknown.map(([k, n]) => `${k} (${n})`).join(", ")}` : "unknown fields: none");
if (verbose) for (const l of rawLog) console.log(`  raw: ${l}`);
if ("writes" in repo) console.log(`dry-run writes skipped: ${JSON.stringify((repo as { writes: unknown }).writes)}`);
