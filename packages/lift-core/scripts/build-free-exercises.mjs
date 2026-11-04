// slims the vendored free-exercise-db dump into the json the catalog imports.
// run manually after updating vendor/: node packages/lift-core/scripts/build-free-exercises.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "vendor/free-exercise-db/exercises.json");
const out = join(root, "src/catalog/free-exercises.json");

const raw = JSON.parse(readFileSync(src, "utf8"));

const slim = raw
  .map((e) => ({
    id: e.id,
    name: e.name.trim(),
    equipment: e.equipment ?? null,
    category: e.category ?? null,
    force: e.force ?? null,
    mechanic: e.mechanic ?? null,
    primaryMuscles: [...(e.primaryMuscles ?? [])],
    secondaryMuscles: [...(e.secondaryMuscles ?? [])],
  }))
  // plain code-unit compare so the output never depends on the machine's locale
  .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

// one entry per line: compact, and upstream changes show up as small diffs
const body = slim.map((e) => "  " + JSON.stringify(e)).join(",\n");
writeFileSync(out, "[\n" + body + "\n]\n");
console.log(`wrote ${slim.length} exercises to ${out}`);
