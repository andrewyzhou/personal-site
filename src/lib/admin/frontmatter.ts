// serialization for cms writes. mdx types use gray-matter; yaml types use
// js-yaml. rules: fixed key order per type (clean diffs), empty optionals
// omitted, dates unquoted iso, experience `year` force-quoted.

import matter from "gray-matter";
import yaml from "js-yaml";

// js-yaml types that should serialize unquoted (dates) are handled by keeping
// them as strings and post-processing; simpler and loader-compatible either way
// since toISODate in the loaders normalizes both.

export function parseMdx(raw: string): { frontmatter: Record<string, unknown>; body: string } {
  const { data, content } = matter(raw);
  return { frontmatter: normalizeDates(data), body: content.replace(/^\n/, "") };
}

export function serializeMdx(
  frontmatter: Record<string, unknown>,
  body: string,
  keyOrder: string[]
): string {
  const ordered = orderKeys(dropEmpty(frontmatter), keyOrder);
  if (Object.keys(ordered).length === 0) {
    return body.endsWith("\n") ? body : body + "\n";
  }
  const fmYaml = yaml.dump(ordered, { lineWidth: -1, noRefs: true }).trimEnd();
  const cleanBody = body.replace(/^\n+/, "").trimEnd();
  return `---\n${unquoteDates(fmYaml)}\n---\n\n${cleanBody}\n`;
}

export function parseYamlFile(raw: string): { frontmatter: Record<string, unknown>; body: string } {
  const data = yaml.load(raw);
  return { frontmatter: normalizeDates(isRecord(data) ? data : { value: data }), body: "" };
}

export function serializeYamlFile(data: unknown, keyOrder?: string[]): string {
  const prepared = isRecord(data) && keyOrder ? orderKeys(dropEmpty(data), keyOrder) : data;
  return unquoteDates(yaml.dump(prepared, { lineWidth: -1, noRefs: true }));
}

// gray-matter/js-yaml parse unquoted dates into Date objects; the cms works in
// iso strings everywhere
function normalizeDates(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v instanceof Date) out[k] = v.toISOString().slice(0, 10);
    else if (Array.isArray(v)) out[k] = v.map((x) => (isRecord(x) ? normalizeDates(x) : x));
    else if (isRecord(v)) out[k] = normalizeDates(v);
    else out[k] = v;
  }
  return out;
}

// js-yaml quotes iso-date strings (they'd re-parse as Dates); the loaders
// accept either, but unquoted matches the hand-written files
function unquoteDates(y: string): string {
  return y.replace(/: ['"](\d{4}-\d{2}-\d{2})['"]$/gm, ": $1");
}

function dropEmpty(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined || v === null) continue;
    if (typeof v === "string" && v === "") continue;
    if (v === false && k === "pinned") continue; // pinned omitted when false
    out[k] = v;
  }
  return out;
}

function orderKeys(data: Record<string, unknown>, keyOrder: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keyOrder) {
    if (k in data) out[k] = data[k];
  }
  for (const k of Object.keys(data)) {
    if (!(k in out)) out[k] = data[k];
  }
  return out;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
