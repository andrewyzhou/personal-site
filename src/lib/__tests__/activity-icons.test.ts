import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { ACTIVITY_ICONS, type ActivityIcon } from "../activity-icons";
import { FAMILIES, GENERIC_ICON, SPORT_TYPE_KEYS, sportTypeIcon } from "../sport-types";
import { renderIcon } from "../../../scripts/icons/render";

// the activity icon set: the files in public/icons/activities are exactly what
// `npm run icons:build` writes from the manifest, every file is used, and every
// sport type resolves to a file

const DIR = path.join(__dirname, "../../../public/icons/activities");
const FILES = fs
  .readdirSync(DIR)
  .filter((f) => f.endsWith(".svg"))
  .map((f) => f.slice(0, -4))
  .sort();
const KEYS = (Object.keys(ACTIVITY_ICONS) as ActivityIcon[]).sort();

describe("activity icon files", () => {
  it("are exactly the manifest's icons", () => {
    expect(FILES).toEqual(KEYS);
  });

  it.each(KEYS)("%s.svg matches the build output (run `npm run icons:build`)", (key) => {
    const file = fs.readFileSync(path.join(DIR, `${key}.svg`), "utf8").replace(/\r\n/g, "\n");
    expect(file).toBe(renderIcon(key));
  });

  it.each(KEYS)("%s.svg is a 24px currentColor icon", (key) => {
    const svg = renderIcon(key);
    const root = /^<svg [^>]*>/.exec(svg)?.[0] ?? "";
    expect(root).toContain('viewBox="0 0 24 24"');
    expect(root).toContain('stroke="currentColor"');
    expect(root).toContain('stroke-width="2"');
    expect(root).toContain('color="#EEEEEE"');
    // no fixed colors, so light mode's invert keeps working
    const colors = [...svg.matchAll(/(?:fill|stroke)="([^"]+)"/g)].map((m) => m[1]);
    for (const c of colors) expect(["none", "currentColor"]).toContain(c);
    // one stroke weight across the set
    const widths = [...svg.matchAll(/stroke-width="([^"]+)"/g)].map((m) => m[1]);
    for (const w of widths) expect(w).toBe("2");
    expect(svg).not.toMatch(/<(image|script|style|foreignObject|use)\b/);
    expect(svg).not.toMatch(/href=/);
  });

  it("every icon is used by a sport type, a family or as the generic icon", () => {
    const used = new Set<string>([GENERIC_ICON, ...SPORT_TYPE_KEYS.map(sportTypeIcon), ...Object.values(FAMILIES).map((f) => f.icon)]);
    expect(KEYS.filter((k) => !used.has(k))).toEqual([]);
  });
});

describe("sport type icons", () => {
  it("every sport type has an icon in the set", () => {
    for (const type of SPORT_TYPE_KEYS) expect(KEYS, type).toContain(sportTypeIcon(type));
  });

  it("only the generic types use the generic icon", () => {
    const generic = SPORT_TYPE_KEYS.filter((t) => sportTypeIcon(t) === GENERIC_ICON);
    expect(generic.sort()).toEqual(["Other", "Workout"]);
  });

  it("distinct sports never share an icon by accident", () => {
    const pairs: [string, string][] = [
      ["Run", "TrailRun"], ["Run", "TreadmillRun"], ["Run", "Walk"], ["Walk", "Hike"],
      ["Ride", "MountainBikeRide"], ["Ride", "IndoorRide"], ["Swim", "OpenWaterSwim"], ["Swim", "Diving"],
      ["Tennis", "Badminton"], ["Tennis", "TableTennis"], ["Kayaking", "Surfing"], ["Windsurf", "Kitesurf"],
      ["AlpineSki", "BackcountrySki"], ["Yoga", "Pilates"], ["Yoga", "Meditation"], ["Meditation", "Breathwork"],
      ["Golf", "DiscGolf"], ["IceSkate", "InlineSkate"], ["Soccer", "AmericanFootball"], ["Hunting", "Archery"],
      ["WeightTraining", "Crossfit"], ["Workout", "HighIntensityIntervalTraining"],
    ];
    for (const [a, b] of pairs) expect(sportTypeIcon(a), `${a} vs ${b}`).not.toBe(sportTypeIcon(b));
  });
});
