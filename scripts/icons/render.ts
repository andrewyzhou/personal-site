import fs from "node:fs";
import path from "node:path";
import * as hugeicons from "@hugeicons/core-free-icons";
import { ACTIVITY_ICONS, type ActivityIcon } from "../../src/lib/activity-icons";

// the svg file for one activity icon. hugeicons ships icons as element lists,
// so they're written out with the published geometry at stroke width 2 and the
// site's root attributes (currentColor; light mode inverts the #EEEEEE default)

const ROOT =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" color="#EEEEEE" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">';
const STROKE_WIDTH = "2";

type Element = readonly [string, Readonly<Record<string, string | number>>];

const kebab = (key: string) => key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

function elementToSvg([tag, attrs]: Element): string {
  const out = Object.entries(attrs)
    .filter(([key]) => key !== "key")
    .map(([key, value]) => `${kebab(key)}="${key === "strokeWidth" ? STROKE_WIDTH : value}"`)
    .join(" ");
  return `<${tag} ${out}/>`;
}

export function renderIcon(key: ActivityIcon): string {
  const source = ACTIVITY_ICONS[key];
  if ("custom" in source) {
    return fs.readFileSync(path.join(__dirname, "custom", source.custom), "utf8").replace(/\r\n/g, "\n").trimEnd() + "\n";
  }
  const elements = (hugeicons as unknown as Record<string, readonly Element[] | undefined>)[source.hugeicons];
  if (!elements) throw new Error(`hugeicons has no ${source.hugeicons} (icon "${key}")`);
  return `${ROOT}${elements.map(elementToSvg).join("")}</svg>\n`;
}
