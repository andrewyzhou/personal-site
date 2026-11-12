// writes public/icons/activities/*.svg from src/lib/activity-icons.ts and
// removes any svg there that the manifest no longer lists.
//   npm run icons:build
import fs from "node:fs";
import path from "node:path";
import { ACTIVITY_ICONS, type ActivityIcon } from "../../src/lib/activity-icons";
import { renderIcon } from "./render";

const OUT = path.join(import.meta.dirname, "../../public/icons/activities");
const keys = Object.keys(ACTIVITY_ICONS) as ActivityIcon[];

fs.mkdirSync(OUT, { recursive: true });
for (const key of keys) fs.writeFileSync(path.join(OUT, `${key}.svg`), renderIcon(key));

const keep = new Set(keys.map((k) => `${k}.svg`));
const removed = fs.readdirSync(OUT).filter((f) => f.endsWith(".svg") && !keep.has(f));
for (const file of removed) fs.rmSync(path.join(OUT, file));

console.log(`wrote ${keys.length} icons${removed.length ? `, removed ${removed.length}: ${removed.join(" ")}` : ""}`);
