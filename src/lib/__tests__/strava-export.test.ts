import { describe, it, expect } from "vitest";
import { gzipSync, strToU8, unzipSync, zipSync } from "fflate";
import { parse as parseCsv } from "csv-parse/sync";
import { sha256Hex } from "../raw-store";
import {
  buildExportManifest,
  classifyExportEntry,
  csvActivityRefs,
  deviceFileKey,
  exportContentType,
  exportName,
  planAttachments,
  stravaIdsNotInCsv,
  type ExportManifestEntry,
} from "../strava-export";

// strava's csv repeats some headers (Elapsed Time, Distance)
const CSV = [
  "Activity ID,Activity Date,Activity Name,Activity Type,Elapsed Time,Distance,Filename,Elapsed Time,Distance",
  '101,"Jul 1, 2026, 5:45:37 AM",Morning Run,Run,1800,5.0,activities/101.fit.gz,1800,5000.0',
  '102,"Jul 2, 2026, 6:00:00 AM","Lift, heavy",Weight Training,3600,0,,3600,0',
  '103,"Jul 3, 2026, 7:00:00 AM","multi\nline name",Ride,3600,20,activities/103.gpx,3600,20000',
  '104,"Jul 4, 2026, 7:00:00 AM",Gone,Run,60,0,activities/104.fit.gz,60,0',
  '105,"Jul 5, 2026, 7:00:00 AM",Missing file,Run,60,0,activities/105.fit.gz,60,0',
].join("\n");

const fitGz = gzipSync(strToU8("pretend fit bytes"));
const gpx = strToU8('<?xml version="1.0"?><gpx></gpx>');

function syntheticZip(): Record<string, Uint8Array> {
  const zipped = zipSync({
    "activities.csv": strToU8(CSV),
    "activities/": new Uint8Array(0),
    "activities/101.fit.gz": fitGz,
    "activities/103.gpx": gpx,
    "activities/104.fit.gz": gzipSync(strToU8("other")),
    "media/abc.jpg": new Uint8Array([0xff, 0xd8, 0xff]),
    "media/clip.mp4": new Uint8Array([0, 0, 0, 0x18]),
    "shoes.csv": strToU8("Shoe Name\npegasus\n"),
    "routes/1.gpx": gpx,
    "messaging.json": strToU8("{}"),
    "__MACOSX/._activities.csv": new Uint8Array([1]),
  });
  return unzipSync(zipped);
}

describe("classifyExportEntry", () => {
  it("marks activity originals as device files and keeps everything else", () => {
    expect(classifyExportEntry("activities/101.fit.gz")).toEqual({ kind: "device-file", contentType: "application/gzip" });
    expect(classifyExportEntry("activities/103.gpx")).toEqual({ kind: "device-file", contentType: "application/gpx+xml" });
    expect(classifyExportEntry("activities/x.fit")?.kind).toBe("device-file");
    expect(classifyExportEntry("activities.csv")).toEqual({ kind: "strava-export-file", contentType: "text/csv" });
    expect(classifyExportEntry("routes/1.gpx")).toEqual({ kind: "strava-export-file", contentType: "application/gpx+xml" });
    expect(classifyExportEntry("media/abc.jpg")?.contentType).toBe("image/jpeg");
    expect(classifyExportEntry("media/clip.mp4")?.contentType).toBe("video/mp4");
    expect(classifyExportEntry("messaging.json")?.contentType).toBe("application/json");
  });

  it("skips directories and mac cruft", () => {
    expect(classifyExportEntry("activities/")).toBeNull();
    expect(classifyExportEntry("__MACOSX/._activities.csv")).toBeNull();
    expect(classifyExportEntry("media/.DS_Store")).toBeNull();
  });

  it("classifies every file of a synthetic export", () => {
    const zip = syntheticZip();
    const kinds = Object.keys(zip)
      .map((p) => [p, classifyExportEntry(p)?.kind ?? null] as const)
      .filter(([, k]) => k !== null);
    expect(kinds.filter(([, k]) => k === "device-file").map(([p]) => p).sort()).toEqual([
      "activities/101.fit.gz",
      "activities/103.gpx",
      "activities/104.fit.gz",
    ]);
    expect(kinds).toHaveLength(9);
  });

  it("falls back to octet-stream for unknown extensions", () => {
    expect(exportContentType("weird.bin")).toBe("application/octet-stream");
  });
});

describe("exportName", () => {
  it("strips directories and the .zip suffix", () => {
    expect(exportName("C:\\Users\\a\\Downloads\\export_161887324.zip")).toBe("export_161887324");
    expect(exportName("/home/a/export_1.ZIP")).toBe("export_1");
    expect(exportName("export_2.zip")).toBe("export_2");
  });
});

describe("csvActivityRefs", () => {
  it("maps rows to strava ids + zip paths despite duplicate headers and quoted fields", () => {
    const refs = csvActivityRefs(parseCsv(CSV) as string[][]);
    expect(refs.map((r) => [r.stravaId, r.filename])).toEqual([
      ["101", "activities/101.fit.gz"],
      ["102", null],
      ["103", "activities/103.gpx"],
      ["104", "activities/104.fit.gz"],
      ["105", "activities/105.fit.gz"],
    ]);
    expect(refs[1].name).toBe("Lift, heavy");
    expect(refs[2].name).toBe("multi\nline name");
    expect(refs[0].date).toBe("Jul 1, 2026, 5:45:37 AM");
  });

  it("skips rows without a numeric id and requires the id column", () => {
    expect(csvActivityRefs([["Activity ID", "Filename"], ["", "x"], ["abc", "y"], ["7", ""]])).toEqual([
      { stravaId: "7", filename: null, name: "", date: "" },
    ]);
    expect(csvActivityRefs([])).toEqual([]);
    expect(() => csvActivityRefs([["Name"], ["x"]])).toThrow(/Activity ID/);
  });
});

describe("buildExportManifest", () => {
  const entries: ExportManifestEntry[] = [
    { path: "shoes.csv", sha256: "b".repeat(64), size: 10, kind: "strava-export-file" },
    { path: "activities/1.fit.gz", sha256: "a".repeat(64), size: 5, kind: "device-file" },
  ];

  it("sorts entries and totals sizes", () => {
    const { manifest } = buildExportManifest("export_1", entries);
    expect(manifest.export).toBe("export_1");
    expect(manifest.fileCount).toBe(2);
    expect(manifest.totalBytes).toBe(15);
    expect(manifest.entries.map((e) => e.path)).toEqual(["activities/1.fit.gz", "shoes.csv"]);
  });

  it("is deterministic regardless of input order", () => {
    const a = buildExportManifest("export_1", entries).bytes;
    const b = buildExportManifest("export_1", [...entries].reverse()).bytes;
    expect(sha256Hex(a)).toBe(sha256Hex(b));
    expect(JSON.parse(new TextDecoder().decode(a)).entries[0].sha256).toBe("a".repeat(64));
  });
});

describe("planAttachments", () => {
  const zip = syntheticZip();
  const entryShas = new Map(Object.entries(zip).map(([p, b]) => [p, sha256Hex(b)]));
  const refs = csvActivityRefs(parseCsv(CSV) as string[][]);

  it("matches by source first, then legacy external id, using the exact archive bytes", () => {
    const plan = planAttachments(refs, {
      bySource: new Map([["101", 1]]),
      byLegacy: new Map([
        ["101", 99], // ignored: the source row wins
        ["102", 2],
        ["103", 3],
        ["105", 5],
      ]),
      entryShas,
      existingDeviceFiles: new Set(),
    });
    expect(plan.attach).toEqual([
      { activityId: 1, stravaId: "101", path: "activities/101.fit.gz", sha256: sha256Hex(fitGz), via: "source", existing: false },
      { activityId: 3, stravaId: "103", path: "activities/103.gpx", sha256: sha256Hex(gpx), via: "legacy", existing: false },
    ]);
    // the sha is of the .gz container, not the unwrapped fit
    expect(plan.attach[0].sha256).not.toBe(sha256Hex(strToU8("pretend fit bytes")));
    expect(plan.noFile.map((r) => r.stravaId)).toEqual(["102"]);
    expect(plan.notInDb.map((r) => r.stravaId)).toEqual(["104"]);
    expect(plan.missingFile.map((r) => r.stravaId)).toEqual(["105"]);
  });

  it("flags sources already present so re-runs are no-ops", () => {
    const plan = planAttachments(refs, {
      bySource: new Map(),
      byLegacy: new Map([["101", 1]]),
      entryShas,
      existingDeviceFiles: new Set([deviceFileKey(1, sha256Hex(fitGz))]),
    });
    expect(plan.attach).toHaveLength(1);
    expect(plan.attach[0].existing).toBe(true);
  });
});

describe("stravaIdsNotInCsv", () => {
  it("lists db ids missing from the export, deduped and sorted", () => {
    const refs = [{ stravaId: "1", filename: null, name: "", date: "" }];
    expect(stravaIdsNotInCsv(["3", "1", "2", "3"], refs)).toEqual(["2", "3"]);
  });
});
