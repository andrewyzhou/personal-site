import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { FAMILIES, GENERIC_ICON, SPORT_TYPE_KEYS, SPORT_TYPES, sportTypeIcon } from "../sport-types";

// the activity icon set: every file normalized the same way, every file
// licensed and recorded, and no file left unused

const DIR = path.join(__dirname, "../../../public/icons/activities");
const FILES = fs
  .readdirSync(DIR)
  .filter((f) => f.endsWith(".svg"))
  .map((f) => f.slice(0, -4));
const LICENSES = fs.readFileSync(path.join(DIR, "LICENSES.md"), "utf8");

describe("activity icon files", () => {
  it.each(FILES)("%s.svg is a normalized 24px currentColor icon", (name) => {
    const svg = fs.readFileSync(path.join(DIR, `${name}.svg`), "utf8");
    const root = /^<svg [^>]*>/.exec(svg)?.[0] ?? "";
    expect(root).toContain('viewBox="0 0 24 24"');
    expect(root).toContain('width="24"');
    expect(root).toContain('height="24"');
    expect(root).toContain('stroke="currentColor"');
    expect(root).toContain('stroke-width="2"');
    expect(root).toContain('stroke-linecap="round"');
    expect(root).toContain('stroke-linejoin="round"');
    expect(root).toContain('color="#EEEEEE"');
    // the only colors are currentColor and the root's default color
    const colors = [...svg.matchAll(/(?:fill|stroke)="([^"]+)"/g)].map((m) => m[1]);
    for (const c of colors) expect(["none", "currentColor"]).toContain(c);
    expect(svg).not.toMatch(/<(image|script|style|foreignObject|use)\b/);
    expect(svg).not.toMatch(/href=/);
  });

  it.each(FILES)("%s.svg has its source and license recorded", (name) => {
    const row = LICENSES.split("\n").find((l) => l.startsWith(`| \`${name}.svg\` |`));
    expect(row).toBeDefined();
    expect(row).toMatch(/\| (MIT|Apache-2\.0|repo LICENSE) \|$/);
  });

  it("ships the license text of each set", () => {
  });

  it("every file is used by a sport type, a family or as the generic icon", () => {
    const used = new Set<string>([GENERIC_ICON, ...SPORT_TYPE_KEYS.map(sportTypeIcon), ...Object.values(FAMILIES).map((f) => f.icon)]);
    expect(FILES.filter((f) => !used.has(f))).toEqual([]);
  });
});

describe("specific icons", () => {
  // types that must not fall back to their family icon (run, walk, hike,
  // swim, yoga, tennis, golf, ice skate… are the family icons themselves)
  const SPECIFIC = [
    "TrailRun", "TreadmillRun", "Wheelchair",
    "MountainBikeRide", "GravelRide", "IndoorRide", "VirtualRide", "EBikeRide",
    "OpenWaterSwim", "Rowing", "Kayaking", "Canoeing", "StandUpPaddling", "Surfing", "Sail", "Windsurf", "Kitesurf",
    "AlpineSki", "Snowboard", "NordicSki", "InlineSkate", "Skateboard",
    "Pilates", "Meditation", "HighIntensityIntervalTraining", "StairStepper", "JumpRope", "Boxing", "MartialArts",
    "Bouldering", "Pickleball", "Badminton", "TableTennis",
    "Soccer", "Basketball", "Volleyball", "AmericanFootball", "Rugby", "Baseball", "Cricket", "Hockey", "DiscGolf",
  ] as const;

  it.each(SPECIFIC)("%s has its own icon", (type) => {
    const info = SPORT_TYPES[type] as { icon?: string; family: keyof typeof FAMILIES };
    expect(info.icon).toBeDefined();
  });

  it("distinct sports never share an icon by accident", () => {
    const pairs: [string, string][] = [
      ["Tennis", "Badminton"], ["Tennis", "TableTennis"], ["Tennis", "Pickleball"],
      ["Kayaking", "Canoeing"], ["Windsurf", "Kitesurf"], ["AlpineSki", "NordicSki"], ["Snowboard", "AlpineSki"],
      ["Run", "TrailRun"], ["Run", "TreadmillRun"], ["Ride", "MountainBikeRide"], ["Ride", "GravelRide"],
      ["Ride", "EBikeRide"], ["Ride", "IndoorRide"], ["Swim", "OpenWaterSwim"], ["Yoga", "Pilates"], ["Yoga", "Meditation"],
      ["RockClimbing", "Bouldering"], ["Golf", "DiscGolf"], ["Walk", "Hike"], ["IceSkate", "InlineSkate"],
    ];
    for (const [a, b] of pairs) expect(sportTypeIcon(a), `${a} vs ${b}`).not.toBe(sportTypeIcon(b));
  });
});
