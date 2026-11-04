// raw store integrity audit, pure comparisons. io lives in
// scripts/audit-raw-integrity.mts. failures make the audit exit non-zero;
// warnings are expected states (e.g. backfilled sources whose originals are
// still in the legacy public bucket).

import { RAW_KEY_PREFIX, isSha256, rawKey, sha256Hex } from "./raw-store";

export interface ManifestEntry {
  sha256: string;
  key: string;
  sizeBytes: number;
  createdAt: Date;
}

export type Severity = "failure" | "warning";

export interface Finding {
  severity: Severity;
  check: string;
  subject: string;
  detail: string;
}

const fail = (check: string, subject: string, detail: string): Finding => ({ severity: "failure", check, subject, detail });
const warn = (check: string, subject: string, detail: string): Finding => ({ severity: "warning", check, subject, detail });

// manifest row vs a HEAD of its object
export function compareHead(row: ManifestEntry, head: { size: number } | null): Finding | null {
  if (row.key !== rawKey(row.sha256)) return fail("manifest", row.sha256, `key ${row.key} ≠ expected ${rawKey(row.sha256)}`);
  if (!head) return fail("head", row.sha256, `object ${row.key} is missing`);
  if (head.size !== row.sizeBytes) return fail("head", row.sha256, `size ${head.size} ≠ manifest ${row.sizeBytes}`);
  return null;
}

// manifest row vs the full bytes
export function compareContent(row: ManifestEntry, bytes: Uint8Array | null): Finding | null {
  if (!bytes) return fail("content", row.sha256, `object ${row.key} is missing`);
  if (bytes.length !== row.sizeBytes) return fail("content", row.sha256, `size ${bytes.length} ≠ manifest ${row.sizeBytes}`);
  const actual = sha256Hex(bytes);
  if (actual !== row.sha256) return fail("content", row.sha256, `bytes hash to ${actual}`);
  return null;
}

// which rows get a full re-hash: everything with --full, otherwise every object
// created in the last `recentDays` plus a random sample of the rest
export function selectForRehash<T extends { createdAt: Date }>(
  rows: T[],
  opts: { full?: boolean; sample?: number; recentDays?: number; now?: number; random?: () => number } = {}
): T[] {
  if (opts.full) return [...rows];
  const now = opts.now ?? Date.now();
  const cutoff = now - (opts.recentDays ?? 8) * 24 * 60 * 60 * 1000;
  const random = opts.random ?? Math.random;
  const recent = rows.filter((r) => r.createdAt.getTime() >= cutoff);
  const rest = rows.filter((r) => r.createdAt.getTime() < cutoff);
  // partial fisher-yates
  const n = Math.min(opts.sample ?? 20, rest.length);
  const pool = [...rest];
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(random() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return [...recent, ...pool.slice(0, n)];
}

export interface SourceRef {
  id: number;
  activityId: number;
  kind: string;
  rawSha256: string | null;
  // the activity's legacy fit_sha256 (backfilled device-file sources point at it)
  legacyFitSha256: string | null;
}

// sources pointing at raw objects with no manifest row. a backfilled device-file
// source whose original hasn't been copied from the public bucket yet is
// expected (warning); anything else is a failure.
export function findDangling(sources: SourceRef[], manifestShas: Set<string>): Finding[] {
  const out: Finding[] = [];
  for (const s of sources) {
    if (!s.rawSha256 || manifestShas.has(s.rawSha256)) continue;
    const subject = `source ${s.id} (activity ${s.activityId}, ${s.kind})`;
    if (s.kind === "device-file" && s.rawSha256 === s.legacyFitSha256) {
      out.push(warn("dangling", subject, `${s.rawSha256} not in raw store yet (legacy original)`));
    } else {
      out.push(fail("dangling", subject, `${s.rawSha256} has no raw_objects row`));
    }
  }
  return out;
}

// bucket keys under sha256/ with no manifest row, or not shaped like a raw key
export function findOrphans(bucketKeys: { key: string; size: number }[], manifestKeys: Set<string>): Finding[] {
  const out: Finding[] = [];
  for (const { key, size } of bucketKeys) {
    if (!key.startsWith(RAW_KEY_PREFIX)) continue;
    const sha = key.slice(key.lastIndexOf("/") + 1);
    if (!isSha256(sha) || rawKey(sha) !== key) {
      out.push(fail("orphan", key, `malformed raw key (${size} bytes)`));
    } else if (!manifestKeys.has(key)) {
      out.push(fail("orphan", key, `no raw_objects row (${size} bytes)`));
    }
  }
  return out;
}

// legacy public-bucket original vs the row's fit_sha256
export function compareLegacyOriginal(
  row: { id: number; fitBlobPathname: string; fitSha256: string },
  result: { exists: boolean; bytes?: Uint8Array | null }
): Finding | null {
  const subject = `activity ${row.id}`;
  if (!result.exists) return fail("legacy-original", subject, `${row.fitBlobPathname} is missing`);
  if (result.bytes) {
    const actual = sha256Hex(result.bytes);
    if (actual !== row.fitSha256) return fail("legacy-original", subject, `${row.fitBlobPathname} hashes to ${actual}, expected ${row.fitSha256}`);
  }
  return null;
}

export function summarizeFindings(findings: Finding[]): { failures: number; warnings: number; byCheck: Record<string, { failures: number; warnings: number }> } {
  const byCheck: Record<string, { failures: number; warnings: number }> = {};
  let failures = 0;
  let warnings = 0;
  for (const f of findings) {
    const c = (byCheck[f.check] ??= { failures: 0, warnings: 0 });
    if (f.severity === "failure") {
      failures++;
      c.failures++;
    } else {
      warnings++;
      c.warnings++;
    }
  }
  return { failures, warnings, byCheck };
}
