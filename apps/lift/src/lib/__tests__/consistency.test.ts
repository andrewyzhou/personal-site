import { describe, expect, it } from "vitest";
import { detectWorkoutPrs, type HistorySet } from "lift-core";
import { contrastRatio } from "../color";
import { dark, light, type Palette } from "../palette";
import { fallbackWorkoutPrs, priorBests, sessionPrFlags, setPrKinds, type SetPrKind } from "../prs";
import { countByDay, dayKey, dayKeyAt, dayKeyLabel, msUntilNextDay, workoutDayKey } from "../calendar";
import { shouldOfferRestore } from "../sync/restoreOffer";

describe("palette contrast", () => {
  // every text color the screens draw, on every surface it can sit on
  const TEXT = ["text", "strong", "muted", "danger", "accent"] as const satisfies readonly (keyof Palette)[];
  const SURFACES = ["bg", "card", "input", "done"] as const satisfies readonly (keyof Palette)[];

  it("matches known wcag values", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
  });

  for (const [name, p] of [
    ["dark", dark],
    ["light", light],
  ] as const) {
    for (const t of TEXT) {
      for (const s of SURFACES) {
        it(`${name}: ${t} on ${s} is at least 4.5:1`, () => {
          expect(contrastRatio(p[t], p[s])).toBeGreaterThanOrEqual(4.5);
        });
      }
    }
    it(`${name}: accent text on accent is at least 4.5:1`, () => {
      expect(contrastRatio(p.accentText, p.accent)).toBeGreaterThanOrEqual(4.5);
    });
  }
});

describe("live badge and summary agree on prs", () => {
  const h = (workoutId: string, startedAt: number, weight: number | null, reps: number | null, extra: Partial<HistorySet> = {}): HistorySet => ({
    workoutId,
    startedAt,
    exerciseId: "dip",
    kind: "normal",
    weight,
    unit: weight === null ? null : "kg",
    reps,
    completed: true,
    ...extra,
  });

  const fixtures: { name: string; history: HistorySet[] }[] = [
    // bodyweight-only earlier session, then the first weighted one
    { name: "bodyweight before", history: [h("w1", 1, null, 12), h("w2", 2, 10, 8), h("w2", 2, 15, 5)] },
    // reps too high for an e1rm earlier, so only the e1rm best is null
    { name: "high reps before", history: [h("w1", 1, 20, 40), h("w2", 2, 15, 10)] },
    // ordinary: earlier loads exist, some sets beat them
    { name: "loaded before", history: [h("w1", 1, 20, 8), h("w2", 2, 20, 10), h("w2", 2, 25, 3)] },
    // first session ever: nothing on either side
    { name: "first session", history: [h("w2", 2, 20, 8)] },
  ];

  const badgeKinds = (history: HistorySet[]): Set<SetPrKind> => {
    const bests = priorBests(history, "dip", "w2");
    const mine = history.filter((s) => s.workoutId === "w2").map((s, i) => ({ ...s, id: String(i) }));
    return new Set(Object.values(sessionPrFlags(bests, mine)).flat());
  };
  const summaryKinds = (hits: { kind: string }[]): Set<string> => new Set(hits.map((x) => x.kind).filter((k) => k !== "volume"));

  for (const f of fixtures) {
    it(`${f.name}: badge kinds match detectWorkoutPrs and the fallback`, () => {
      const badges = badgeKinds(f.history);
      expect(summaryKinds(detectWorkoutPrs(f.history, "w2"))).toEqual(badges);
      expect(summaryKinds(fallbackWorkoutPrs(f.history, "w2"))).toEqual(badges);
    });
  }

  it("a null prior best is beatable once earlier sessions exist", () => {
    const bests = priorBests([h("w1", 1, null, 12)], "dip");
    expect(bests.sessions).toBe(1);
    expect(setPrKinds(bests, { kind: "normal", weight: 10, unit: "kg", reps: 8 })).toEqual(["e1rm", "weight"]);
    const highRep = priorBests([h("w1", 1, 20, 40)], "dip");
    expect(setPrKinds(highRep, { kind: "normal", weight: 15, unit: "kg", reps: 10 })).toEqual(["e1rm"]);
  });

  it("fallback volume with no earlier volume reports a null previous, like lift-core", () => {
    const history = fixtures[0]!.history;
    const core = detectWorkoutPrs(history, "w2").find((x) => x.kind === "volume");
    const local = fallbackWorkoutPrs(history, "w2").find((x) => x.kind === "volume");
    expect(core?.previous).toBeNull();
    expect(local).toEqual(core);
  });
});

describe("workout day keys", () => {
  // 2026-11-04 23:30 in tokyo (+9:00) is 14:30 utc
  const tokyoLate = Date.UTC(2026, 10, 4, 14, 30);

  it("uses the offset the workout was logged at", () => {
    expect(dayKeyAt(tokyoLate, 540)).toBe("2026-11-04");
    // the same instant in new york (-5:00) was still the 4th, morning
    expect(dayKeyAt(tokyoLate, -300)).toBe("2026-11-04");
    // 01:30 the next day in tokyo is the 5th there, the 4th in new york
    const tokyoEarly = Date.UTC(2026, 10, 4, 16, 30);
    expect(dayKeyAt(tokyoEarly, 540)).toBe("2026-11-05");
    expect(dayKeyAt(tokyoEarly, -300)).toBe("2026-11-04");
  });

  it("a workout logged in another timezone keeps its local day, whatever the phone's zone", () => {
    const w = { startedAt: Date.UTC(2026, 10, 4, 16, 30), utcOffsetMin: 540 };
    expect(workoutDayKey(w)).toBe("2026-11-05");
    const counts = countByDay([w, { startedAt: Date.UTC(2026, 10, 5, 3, 0), utcOffsetMin: 540 }], workoutDayKey);
    expect(counts.get("2026-11-05")).toBe(2);
  });

  it("falls back to the phone's zone when no offset was stored", () => {
    const ms = new Date(2026, 10, 4, 23, 59).getTime();
    expect(workoutDayKey({ startedAt: ms, utcOffsetMin: null })).toBe(dayKey(ms));
    expect(workoutDayKey({ startedAt: ms })).toBe("2026-11-04");
  });

  it("labels a key without going through the phone's zone", () => {
    expect(dayKeyLabel("2026-11-05")).toBe("nov 5, 2026");
    expect(dayKeyLabel("2026-01-31")).toBe("jan 31, 2026");
  });

  it("schedules the next refresh at local midnight", () => {
    const now = new Date(2026, 10, 4, 23, 0).getTime();
    expect(now + msUntilNextDay(now)).toBe(new Date(2026, 10, 5).getTime());
    expect(msUntilNextDay(new Date(2026, 10, 5).getTime() - 1)).toBe(1000);
  });
});

describe("restore offer", () => {
  const base = { localRows: 0, pending: 0, restoredAt: null, dismissed: false };

  it("appears for an empty db once any token is saved, typed in or kept by the keychain", () => {
    expect(shouldOfferRestore({ ...base, hasToken: false })).toBe(false);
    // android reinstall: no keychain survival, then the user saves a token in settings
    expect(shouldOfferRestore({ ...base, hasToken: true })).toBe(true);
  });

  it("stays hidden once there's local data or it was dismissed", () => {
    expect(shouldOfferRestore({ ...base, hasToken: true, localRows: 1 })).toBe(false);
    expect(shouldOfferRestore({ ...base, hasToken: true, dismissed: true })).toBe(false);
  });
});
