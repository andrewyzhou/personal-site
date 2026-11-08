import { readFileSync } from "node:fs";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { customExerciseId, sha256Hex, type ParsedWorkout } from "lift-core";
import {
  activityQueryRange,
  applyCommand,
  buildCsvReport,
  countDataRows,
  MAX_ZIP_CSV_BYTES,
  csvFromZip,
  decodeCsv,
  fixExportHeader,
  formatCsvReport,
  parseExport,
  simulateLinks,
  type ActivityRow,
} from "@/lib/lift/csv-report";
import { partitionCsvWorkouts } from "@/lib/lift/workout-csv";

const dir = join(__dirname, "fixtures", "workout-export");
const MAIN = readFileSync(join(dir, "workouts.csv"), "utf8");
const SEMI = readFileSync(join(dir, "workouts-semicolon.csv"), "utf8");
const TZ = "America/Los_Angeles";

const allSets = (ws: readonly ParsedWorkout[]) => ws.flatMap((w) => w.exercises.flatMap((e) => e.sets));

/** a recording starting `deltaMin` from a local wall-clock start */
function rec(id: number, startedLocal: string, deltaMin: number, elapsedMin: number, sportType = "WeightTraining"): ActivityRow {
  const [d, t] = startedLocal.split("T");
  const [y, mo, da] = d.split("-").map(Number);
  const [h, mi] = t.split(":").map(Number);
  const at = new Date(Date.UTC(y, mo - 1, da, h, mi + deltaMin)).toISOString();
  return { id, sportType, localDate: at.slice(0, 10), localTime: at.slice(11, 16), elapsedS: elapsedMin * 60 };
}

function report(input: Partial<Parameters<typeof buildCsvReport>[0]> = {}) {
  return buildCsvReport({
    file: "workouts.csv",
    sha256: sha256Hex(MAIN),
    parsedExport: parseExport(MAIN),
    existing: [],
    activities: [],
    timezone: TZ,
    ...input,
  });
}

describe("parsing the export fixture", () => {
  const ex = parseExport(MAIN);
  const workouts = ex.parsed.workouts;

  it("reads every workout, row and edge case", () => {
    expect(ex.rows).toBe(719);
    expect(workouts).toHaveLength(40);
    expect(workouts[0].startedLocal).toBe("2026-04-02T17:31");
    expect(workouts[39].startedLocal?.slice(0, 7)).toBe("2026-09");
    expect(ex.parsed.warnings.map((w) => w.message)).toEqual(['unreadable weight "12o"', "row without an exercise name"]);

    const sets = allSets(workouts);
    const kinds = new Set(sets.map((s) => s.kind));
    expect([...kinds].sort()).toEqual(["drop", "failure", "normal", "warmup"]);
    // bodyweight pull-ups, timed planks and treadmill distance survive the zeros the export writes
    expect(sets.some((s) => s.bodyweight && s.reps === 8 && s.weight === null)).toBe(true);
    expect(sets.some((s) => s.durationS === 75 && s.weight === null && s.reps === null)).toBe(true);
    expect(sets.some((s) => s.distance !== null && s.distanceUnit === "mi" && s.durationS !== null)).toBe(true);
    // rest timer rows are not sets
    expect(sets.every((s) => !/Rest Timer/.test(s.raw))).toBe(true);
  });

  it("keeps quoted notes with commas, quotes and line breaks", () => {
    const notes = workouts.flatMap((w) => w.notes);
    expect(notes).toContain("skipped last set, gym packed");
    expect(notes).toContain('new "program" week 1, deload next');
    const setNotes = allSets(workouts).map((s) => s.note);
    expect(setNotes).toContain('left shoulder "clicky", paused reps');
    expect(setNotes).toContain("belt on\nfelt strong");
  });

  it("defaults to lb and says so, unless told otherwise", () => {
    expect(ex.unit).toMatchObject({ unit: "lb", source: "default" });
    expect(ex.unit.note).toMatch(/--unit kg/);
    const kg = parseExport(MAIN, "kg");
    expect(kg.unit).toMatchObject({ unit: "kg", source: "flag", note: null });
    expect(allSets(kg.parsed.workouts).filter((s) => s.weight !== null).every((s) => s.unit === "kg")).toBe(true);
  });

  it("reads the semicolon / decimal-comma variant with its own unit column", () => {
    const semi = parseExport(SEMI);
    expect(semi.rows).toBe(9);
    expect(semi.unit).toMatchObject({ unit: "kg", source: "column", sets: { kg: 7, lb: 0 } });
    // a flag can't override units the rows spell out
    expect(parseExport(SEMI, "lb").unit).toMatchObject({ unit: "kg", source: "column" });
    const [upper, legs] = semi.parsed.workouts;
    expect(upper.title).toBe("Oberkörper");
    expect(upper.exercises[0].sets[1]).toMatchObject({ weight: 82.5, unit: "kg", rpe: 8.5, note: "gut; schnell" });
    expect(legs.notes).toEqual(["Knie ok", "nächstes Mal 112,5"]);
    expect(legs.exercises[1].sets[0]).toMatchObject({ distance: 3.2, distanceUnit: "km", durationS: 1260 });
  });

  it("reads unit-suffixed headers instead of losing the weight column", () => {
    const csv = [
      "Workout #,Date,Workout Name,Duration (sec),Exercise Name,Set Order,Weight (kg),Reps,Distance (meters),Seconds,Notes,Workout Notes,RPE",
      "1,2026-10-10 09:00:00,Morning,3600,Squat (Barbell),1,100,5,0,0,,,",
      "1,2026-10-10 09:00:00,Morning,3600,Rowing (Machine),1,0,0,2000,480,,,",
    ].join("\n");
    const fix = fixExportHeader(csv);
    expect(fix).toMatchObject({ weightUnit: "kg", distanceUnit: "m" });
    expect(fix.renamed).toEqual(["Duration (sec)", "Weight (kg)", "Distance (meters)"]);
    const p = parseExport(csv);
    expect(p.unit).toMatchObject({ unit: "kg", source: "header" });
    const [w] = p.parsed.workouts;
    expect(w.durationS).toBe(3600);
    expect(w.exercises[0].sets[0]).toMatchObject({ weight: 100, unit: "kg", bodyweight: false });
    expect(w.exercises[1].sets[0]).toMatchObject({ distance: 2000, distanceUnit: "m" });
    // a plain header is left byte-for-byte alone
    expect(fixExportHeader(MAIN).text).toBe(MAIN);
  });

  it("counts records, not lines", () => {
    expect(countDataRows('a,b\n1,"x\ny"\n\n2,z\n')).toBe(2);
    expect(countDataRows("a,b\n")).toBe(0);
  });
});

describe("input files", () => {
  it("picks the first real csv out of a zip", () => {
    const zip = zipSync({
      "__MACOSX/._workouts.csv": strToU8("junk"),
      "readme.txt": strToU8("hi"),
      "export/workouts.csv": strToU8(SEMI),
      "other.csv": strToU8("x"),
    });
    expect(csvFromZip(zip)).toEqual({ name: "export/workouts.csv", text: SEMI });
    expect(csvFromZip(zipSync({ "a.txt": strToU8("no") }))).toBeNull();
  });

  // central directory entries: signature, then method at +10 and uncompressed size at +24
  function patchCentral(zip: Uint8Array, name: string, patch: (view: DataView, at: number) => void): Uint8Array {
    const out = zip.slice();
    const view = new DataView(out.buffer);
    for (let i = 0; i + 46 <= out.length; i++) {
      if (view.getUint32(i, true) !== 0x02014b50) continue;
      const len = view.getUint16(i + 28, true);
      if (new TextDecoder().decode(out.subarray(i + 46, i + 46 + len)) === name) patch(view, i);
    }
    return out;
  }

  it("inflates only the first csv", () => {
    const zip = zipSync({ "workouts.csv": strToU8(SEMI), "later.csv": strToU8("x".repeat(500)) });
    // an unknown method throws if fflate ever tries to inflate the second entry
    const poisoned = patchCentral(zip, "later.csv", (v, at) => v.setUint16(at + 10, 99, true));
    expect(csvFromZip(poisoned)).toEqual({ name: "workouts.csv", text: SEMI });
  });

  it("refuses a csv entry that claims more than the size cap", () => {
    const zip = zipSync({ "workouts.csv": strToU8(SEMI) });
    const huge = patchCentral(zip, "workouts.csv", (v, at) => v.setUint32(at + 24, MAX_ZIP_CSV_BYTES + 1, true));
    expect(() => csvFromZip(huge)).toThrow(/too large to import/);
  });

  it("decodes utf-16 re-saves", () => {
    const text = "Date,Exercise Name\n";
    const bytes = new Uint8Array([0xff, 0xfe, ...[...text].flatMap((c) => [c.charCodeAt(0), 0])]);
    expect(decodeCsv(bytes)).toBe(`\ufeff${text}`.slice(1));
  });
});

describe("dry run report", () => {
  const workouts = parseExport(MAIN).parsed.workouts;

  it("skips what's already logged by title or by exercises at the same minute", () => {
    const [w0, , , , , w5, w6] = workouts;
    const names = (w: ParsedWorkout) => w.exercises.map((e) => e.name);
    const { report: r, fresh } = report({
      existing: [
        { id: "share-a", title: w0.title.toUpperCase(), startedLocal: w0.startedLocal! },
        // renamed on the phone, same lifts
        { id: "share-b", title: "Renamed", startedLocal: w5.startedLocal!, exerciseNames: names(w5).slice(0, 3) },
        // same minute but a different session (only 2 of 5 lifts)
        { id: "share-c", title: "Other", startedLocal: w6.startedLocal!, exerciseNames: names(w6).slice(0, 2) },
        { id: "share-d", title: w0.title, startedLocal: "2020-01-01T00:00" },
      ],
    });
    expect(r.present).toMatchObject({ total: 2, byTitle: 1, byExercises: 1, repeatedInCsv: 0 });
    expect(r.present.sample[0]).toBe(`${w0.startedLocal} ${w0.title} (title)`);
    expect(fresh).toHaveLength(38);
    expect(fresh.map((w) => w.startedLocal)).toContain(w6.startedLocal);
    expect(r.fresh.workouts).toBe(38);
    expect(r.nextCommand).toBe("npm run lift:import-csv -- workouts.csv --unit lb --apply");
  });

  it("lists custom exercises: new, known, and merged", () => {
    const fresh = report().report.exercises;
    expect(fresh.distinct).toBe(23);
    expect(fresh.catalog).toBe(20);
    expect(fresh.newCustom.map((u) => [u.name, u.workouts, u.sets])).toEqual([
      ["Zercher Wobble Hold (Barbell)", 4, 8],
      ["Sled Push (Turf)", 1, 3],
      ["Banded Pallof Walkout", 1, 2],
    ]);
    expect(fresh.checked).toBe(false);

    const r = report({
      knownExerciseIds: new Set([customExerciseId("Sled Push (Turf)")]),
      redirects: new Map([[customExerciseId("Banded Pallof Walkout"), "face-pull-cable"]]),
    }).report.exercises;
    expect(r.checked).toBe(true);
    expect(r.newCustom.map((u) => u.name)).toEqual(["Zercher Wobble Hold (Barbell)"]);
    expect(r.existingCustom.map((u) => u.name)).toEqual(["Sled Push (Turf)"]);
    expect(r.merged).toEqual([{ name: "Banded Pallof Walkout", into: "face-pull-cable" }]);
  });

  it("predicts watch links by role from one list of recordings", () => {
    const [a, b, c, d] = workouts.map((w) => w.startedLocal!);
    const recordings = [
      rec(1, a, 1, 60),
      rec(2, a, 3, 58), // second device, overlapping
      rec(3, b, -2, 30),
      rec(4, b, 35, 25), // split recording after a 7 min gap
      rec(5, c, -45, 120), // watch started early and left running
      rec(6, d, 0, 40, "Run"), // any sport links now
    ];
    const r = report({ activities: recordings }).report.linking;
    expect(r).toEqual({
      checked: true,
      recordings: 6,
      linkedWorkouts: 4,
      liftOnly: 36,
      anchoredBy: { primary: 3, overrun: 1 },
      links: { primary: 3, duplicate: 1, continuation: 1, overrun: 1 },
    });
    expect(activityQueryRange(workouts)).toEqual({ from: "2026-04-01", to: "2026-09-25" });
  });

  it("never hands one recording to two workouts", () => {
    const mk = (startedLocal: string) => ({ ...workouts[0], startedLocal });
    const links = simulateLinks([mk("2026-10-01T10:00"), mk("2026-10-01T10:25")], [rec(9, "2026-10-01T10:00", 10, 50)]);
    expect(links).toEqual([{ roles: ["primary"] }, { roles: [] }]);
  });

  it("says nothing is new when everything is logged", () => {
    const existing = workouts.map((w) => ({ title: w.title, startedLocal: w.startedLocal! }));
    const { report: r } = report({ existing });
    expect(r.present.total).toBe(40);
    expect(r.nextCommand).toBeNull();
    expect(formatCsvReport(r)).toMatch(/nothing new to import$/);
    // and partitioning the same list again agrees
    expect(partitionCsvWorkouts(workouts, existing).fresh).toEqual([]);
  });

  it("prints a summary with the next command", () => {
    const { report: r } = report({ file: "C:\\Users\\me\\Downloads\\workout export.csv", activities: [rec(1, workouts[0].startedLocal!, 2, 60)] });
    const text = formatCsvReport(r);
    expect(text).toContain("rows:        719");
    expect(text).toContain("weights:     lb (default)");
    expect(text).toContain("new workouts: 40");
    expect(text).toContain("Zercher Wobble Hold (Barbell) - 4 workouts, 8 sets");
    expect(text).toContain("would link:  1 workouts (1 by start time, 0 inside a long recording)");
    expect(text).toContain("lift-only:   39 workouts");
    expect(text).toContain('line 294: unreadable weight "12o"');
    expect(text).toContain('npm run lift:import-csv -- "C:\\Users\\me\\Downloads\\workout export.csv" --unit lb --apply');
    // the json form round-trips
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
  });

  it("treats everything as new without a db", () => {
    const { report: r } = report({ existing: null, activities: null });
    expect(r.dbChecked).toBe(false);
    expect(r.linking).toMatchObject({ checked: false, liftOnly: 40 });
    expect(formatCsvReport(r)).toContain("watch recordings: not checked");
  });

  it("quotes only when it has to", () => {
    expect(applyCommand("./workouts.csv", "kg")).toBe("npm run lift:import-csv -- ./workouts.csv --unit kg --apply");
  });
});
