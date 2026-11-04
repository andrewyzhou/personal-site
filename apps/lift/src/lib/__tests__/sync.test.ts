import { describe, expect, it, vi } from "vitest";
import { SNAPSHOT_ENTITIES, SNAPSHOT_PAGE_MAX, SYNC_PROTOCOL_VERSION, type SnapshotEntity, type SyncSnapshot } from "lift-core";
import { backoffDelay } from "../sync/backoff";
import {
  buildPushRequest,
  endpoint,
  isRetryableRejection,
  parsePushResponse,
  planAck,
  toMutation,
  type OutboxLike,
} from "../sync/mutations";
import { pushAll, type FetchLike } from "../sync/push";
import {
  chunk,
  fetchSnapshot,
  parseSnapshot,
  parseSnapshotPage,
  restoreBlocker,
  restorePlan,
  wipeOrder,
} from "../sync/snapshot";
import { polylinePoints, scalePoints } from "../../components/charts/scale";
import { formatDuration, formatKg, formatVolume } from "../../components/charts/units";

function row(id: number, over: Partial<OutboxLike> = {}): OutboxLike {
  return {
    id,
    entity: "set",
    entityId: `s${id}`,
    op: "insert",
    payload: JSON.stringify({ id: `s${id}`, reps: id }),
    createdAt: 1000 + id,
    ...over,
  };
}

describe("toMutation", () => {
  it("maps outbox columns onto the contract", () => {
    expect(toMutation(row(7))).toEqual({
      seq: 7,
      entity: "set",
      id: "s7",
      op: "insert",
      payload: { id: "s7", reps: 7 },
      at: 1007,
    });
  });
  it("sends null payloads for deletes", () => {
    expect(toMutation(row(3, { op: "delete", payload: '{"id":"s3"}' })).payload).toBeNull();
  });
  it("refuses unknown entities and ops", () => {
    expect(() => toMutation(row(1, { entity: "nope" }))).toThrow(/entity/);
    expect(() => toMutation(row(1, { op: "upsert" }))).toThrow(/op/);
  });
  it("builds a request", () => {
    const req = buildPushRequest("dev", [row(1), row(2)]);
    expect(req.protocol).toBe(SYNC_PROTOCOL_VERSION);
    expect(req.deviceId).toBe("dev");
    expect(req.mutations.map((m) => m.seq)).toEqual([1, 2]);
  });
});

describe("parsePushResponse", () => {
  it("accepts a valid body and normalizes rejections", () => {
    expect(
      parsePushResponse({ ok: true, appliedThrough: 5, applied: 4, skipped: 1, rejected: [{ seq: 2 }, "x"] })
    ).toEqual({ ok: true, appliedThrough: 5, applied: 4, skipped: 1, rejected: [{ seq: 2, reason: "rejected" }] });
  });
  it("rejects garbage", () => {
    expect(parsePushResponse(null)).toBeNull();
    expect(parsePushResponse({ ok: false, appliedThrough: 1 })).toBeNull();
    expect(parsePushResponse({ ok: true })).toBeNull();
  });
});

describe("planAck", () => {
  const res = (appliedThrough: number, rejected: { seq: number; reason: string }[] = []) => ({
    ok: true as const,
    appliedThrough,
    applied: 0,
    skipped: 0,
    rejected,
  });
  it("marks through appliedThrough", () => {
    expect(planAck([4, 5, 6], res(5))).toEqual({ syncedThrough: 5, seqs: [4, 5], rejected: [], progressed: true });
  });
  it("never marks past what was sent", () => {
    expect(planAck([4, 5, 6], res(99)).syncedThrough).toBe(6);
  });
  it("reports no progress when the server is behind the batch", () => {
    expect(planAck([4, 5], res(3))).toEqual({ syncedThrough: null, seqs: [], rejected: [], progressed: false });
    expect(planAck([], res(3)).progressed).toBe(false);
  });
  it("keeps only rejections inside the acked range", () => {
    const plan = planAck(
      [1, 2, 3],
      res(2, [
        { seq: 2, reason: "bad" },
        { seq: 3, reason: "later" },
        { seq: 50, reason: "foreign" },
      ])
    );
    expect(plan.rejected).toEqual([{ seq: 2, reason: "bad" }]);
  });
});

describe("endpoint", () => {
  it("joins and validates", () => {
    expect(endpoint("https://x.org/", "/api/lift/sync")).toBe("https://x.org/api/lift/sync");
    expect(endpoint(" http://10.0.0.2:3000 ", "api")).toBe("http://10.0.0.2:3000/api");
    expect(endpoint("x.org", "/a")).toBeNull();
    expect(endpoint("", "/a")).toBeNull();
  });
});

describe("backoffDelay", () => {
  it("doubles with jitter between half and full, capped", () => {
    expect(backoffDelay(0)).toBe(0);
    expect(backoffDelay(1, { random: () => 0 })).toBe(15_000);
    expect(backoffDelay(1, { random: () => 1 })).toBe(30_000);
    expect(backoffDelay(3, { random: () => 1 })).toBe(120_000);
    expect(backoffDelay(50, { random: () => 1 })).toBe(30 * 60_000);
  });
});

// in-memory outbox driven by the push loop
function store(n: number) {
  const rows = Array.from({ length: n }, (_, i) => ({ ...row(i + 1), syncedAt: null as number | null, rejected: null as string | null }));
  return {
    rows,
    readBatch: (limit: number) => rows.filter((r) => r.syncedAt === null).slice(0, limit),
    ack: (plan: { seqs: number[]; rejected: { seq: number; reason: string }[] }) => {
      for (const r of plan.rejected) rows.find((x) => x.id === r.seq)!.rejected = r.reason;
      const acked = new Set(plan.seqs);
      for (const r of rows) if (r.syncedAt === null && acked.has(r.id)) r.syncedAt = 1;
    },
  };
}

function okFetch(handler: (body: { mutations: { seq: number }[] }) => unknown, status = 200) {
  return vi.fn<FetchLike>(async (_url, init) => {
    const body = JSON.parse(init.body ?? "{}");
    return { status, json: async () => handler(body) };
  });
}

describe("pushAll", () => {
  const base = { baseUrl: "https://x.org", token: "t", deviceId: "dev" };

  it("drains in batches and sends bearer + contract body", async () => {
    const s = store(7);
    const f = okFetch((b) => ({
      ok: true,
      appliedThrough: b.mutations.at(-1)!.seq,
      applied: b.mutations.length,
      skipped: 0,
      rejected: [],
    }));
    const r = await pushAll({ ...base, fetch: f, readBatch: s.readBatch, ack: s.ack, maxBatch: 3 });
    expect(r).toMatchObject({ ok: true, pushed: 7, applied: 7, rounds: 3 });
    expect(f).toHaveBeenCalledTimes(3);
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe("https://x.org/api/lift/sync");
    expect(init.headers.authorization).toBe("Bearer t");
    expect(JSON.parse(init.body!).mutations).toHaveLength(3);
    expect(s.rows.every((x) => x.syncedAt !== null)).toBe(true);
  });

  it("stores rejection reasons and still marks them synced", async () => {
    const s = store(3);
    const f = okFetch(() => ({ ok: true, appliedThrough: 3, applied: 2, skipped: 0, rejected: [{ seq: 2, reason: "bad row" }] }));
    const r = await pushAll({ ...base, fetch: f, readBatch: s.readBatch, ack: s.ack });
    expect(r).toMatchObject({ ok: true, rejected: 1 });
    expect(s.rows[1]).toMatchObject({ syncedAt: 1, rejected: "bad row" });
  });

  it("keeps everything unsynced on http errors and network failures", async () => {
    for (const f of [
      okFetch(() => ({}), 500),
      okFetch(() => ({}), 401),
      vi.fn<FetchLike>(async () => {
        throw new TypeError("network request failed");
      }),
      okFetch(() => ({ nope: true })),
    ]) {
      const s = store(2);
      const r = await pushAll({ ...base, fetch: f, readBatch: s.readBatch, ack: s.ack });
      expect(r.ok).toBe(false);
      expect(s.rows.every((x) => x.syncedAt === null)).toBe(true);
    }
  });

  it("partial ack leaves the tail for the next round", async () => {
    const s = store(4);
    let call = 0;
    const f = okFetch((b) => {
      call++;
      // first round only takes two
      const through = call === 1 ? b.mutations[1]!.seq : b.mutations.at(-1)!.seq;
      return { ok: true, appliedThrough: through, applied: 2, skipped: 0, rejected: [] };
    });
    const r = await pushAll({ ...base, fetch: f, readBatch: s.readBatch, ack: s.ack });
    expect(r).toMatchObject({ ok: true, pushed: 4, rounds: 2 });
    expect(JSON.parse(f.mock.calls[1]![1].body!).mutations.map((m: { seq: number }) => m.seq)).toEqual([3, 4]);
  });

  it("stops when the server makes no progress", async () => {
    const s = store(2);
    const f = okFetch(() => ({ ok: true, appliedThrough: 0, applied: 0, skipped: 0, rejected: [] }));
    const r = await pushAll({ ...base, fetch: f, readBatch: s.readBatch, ack: s.ack });
    expect(r.ok).toBe(false);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("halves the batch on 413 until it fits, then keeps draining", async () => {
    const s = store(10);
    const sizes: number[] = [];
    const f = vi.fn<FetchLike>(async (_url, init) => {
      const b = JSON.parse(init.body!) as { mutations: { seq: number }[] };
      sizes.push(b.mutations.length);
      if (b.mutations.length > 3) return { status: 413, json: async () => ({ ok: false, error: "body too large" }) };
      return {
        status: 200,
        json: async () => ({ ok: true, appliedThrough: b.mutations.at(-1)!.seq, applied: b.mutations.length, skipped: 0, rejected: [] }),
      };
    });
    const r = await pushAll({ ...base, fetch: f, readBatch: s.readBatch, ack: s.ack, maxBatch: 10 });
    expect(r).toMatchObject({ ok: true, pushed: 10 });
    expect(sizes).toEqual([10, 5, 2, 2, 2, 2, 2]);
    expect(s.rows.every((x) => x.syncedAt !== null)).toBe(true);
  });

  it("gives up when a single row is still too large, without spinning", async () => {
    const s = store(4);
    const f = okFetch(() => ({ ok: false, error: "body too large" }), 413);
    const r = await pushAll({ ...base, fetch: f, readBatch: s.readBatch, ack: s.ack });
    expect(r).toMatchObject({ ok: false, kind: "too_large", status: 413 });
    if (!r.ok) expect(r.error).toMatch(/change 1 is too large/);
    // 4 -> 2 -> 1 -> stop
    expect(f).toHaveBeenCalledTimes(3);
    expect(s.rows.every((x) => x.syncedAt === null)).toBe(true);
  });

  it("surfaces 400, 401 and 5xx as distinct failures", async () => {
    const cases: [number, unknown, string, RegExp][] = [
      [400, { ok: false, error: "unsupported protocol (expected 1)" }, "bad_request", /refused the batch: unsupported protocol/],
      [401, { ok: false, error: "unauthorized" }, "unauthorized", /app token/],
      [503, {}, "server", /server error 503/],
    ];
    for (const [status, body, kind, msg] of cases) {
      const s = store(2);
      const f = okFetch(() => body, status);
      const r = await pushAll({ ...base, fetch: f, readBatch: s.readBatch, ack: s.ack });
      expect(r).toMatchObject({ ok: false, kind, status });
      if (!r.ok) expect(r.error).toMatch(msg);
      expect(f).toHaveBeenCalledTimes(1);
    }
  });

  it("does nothing without a token or url, and succeeds on an empty outbox", async () => {
    const s = store(0);
    const f = okFetch(() => ({}));
    expect((await pushAll({ ...base, token: "", fetch: f, readBatch: s.readBatch, ack: s.ack })).ok).toBe(false);
    expect((await pushAll({ ...base, baseUrl: "nope", fetch: f, readBatch: s.readBatch, ack: s.ack })).ok).toBe(false);
    expect(await pushAll({ ...base, fetch: f, readBatch: s.readBatch, ack: s.ack })).toMatchObject({ ok: true, pushed: 0 });
    expect(f).not.toHaveBeenCalled();
  });
});

function snapshot(over: Partial<SyncSnapshot> = {}): SyncSnapshot {
  const t = { createdAt: 1, updatedAt: 1 };
  return {
    protocol: SYNC_PROTOCOL_VERSION,
    generatedAt: 1,
    customExercises: [],
    templateFolders: [{ id: "f1", name: "a", position: 0, ...t }],
    templates: [
      { id: "t1", folderId: "f1", name: "x", notes: null, position: 0, archived: 0, ...t },
      { id: "t2", folderId: "gone", name: "y", notes: null, position: 1, archived: 0, ...t },
    ],
    templateExercises: [
      { id: "te1", templateId: "t1", exerciseId: "e", position: 0, supersetGroup: null, restS: null, plannedSets: "[]", notes: null, ...t },
      { id: "te2", templateId: "missing", exerciseId: "e", position: 0, supersetGroup: null, restS: null, plannedSets: "[]", notes: null, ...t },
    ],
    workouts: [
      { id: "w1", title: "a", startedAt: 1, endedAt: 2, utcOffsetMin: 0, status: "finished", templateId: null, notes: null, ...t },
    ],
    workoutExercises: [
      { id: "we1", workoutId: "w1", exerciseId: "e", position: 0, notes: null, supersetGroup: null, restS: null, ...t },
      { id: "we2", workoutId: "w9", exerciseId: "e", position: 0, notes: null, supersetGroup: null, restS: null, ...t },
    ],
    sets: [
      { id: "s1", workoutExerciseId: "we1", position: 0, kind: "normal", weight: 100, unit: "lb", reps: 5, durationS: null, distanceM: null, rpe: null, completed: 1, note: null, ...t },
      { id: "s2", workoutExerciseId: "we2", position: 0, kind: "normal", weight: 100, unit: "lb", reps: 5, durationS: null, distanceM: null, rpe: null, completed: 1, note: null, ...t },
    ],
    bodyweights: [],
    ...over,
  };
}

describe("restore plan", () => {
  it("orders parents before children and wipes in reverse", () => {
    const plan = restorePlan(snapshot());
    expect(plan.steps.map((s) => s.entity)).toEqual([
      "custom_exercise",
      "template_folder",
      "template",
      "template_exercise",
      "workout",
      "workout_exercise",
      "set",
      "bodyweight",
    ]);
    expect(wipeOrder(plan)[0]).toBe("bodyweight");
    expect(wipeOrder(plan).indexOf("set")).toBeLessThan(wipeOrder(plan).indexOf("workout"));
  });
  it("drops orphans, nulls missing folders, counts what lands", () => {
    const plan = restorePlan(snapshot());
    const get = (e: string) => plan.steps.find((s) => s.entity === e)!.rows as { id: string; folderId?: string | null }[];
    expect(get("template").find((t) => t.id === "t2")!.folderId).toBeNull();
    expect(get("template_exercise").map((r) => r.id)).toEqual(["te1"]);
    expect(get("workout_exercise").map((r) => r.id)).toEqual(["we1"]);
    expect(get("set").map((r) => r.id)).toEqual(["s1"]);
    expect(plan.dropped).toBe(3);
    expect(plan.counts).toEqual({ workouts: 1, sets: 1 });
  });
  it("dedupes ids, last wins", () => {
    const s = snapshot();
    s.workouts.push({ ...s.workouts[0]!, title: "b" });
    const w = restorePlan(s).steps.find((x) => x.entity === "workout")!.rows as { title: string }[];
    expect(w).toHaveLength(1);
    expect(w[0]!.title).toBe("b");
  });
  it("validates snapshots", () => {
    expect(parseSnapshot(JSON.parse(JSON.stringify(snapshot())))).toBeTruthy();
    expect(() => parseSnapshot({ ...snapshot(), protocol: 2 })).toThrow(/protocol/);
    expect(() => parseSnapshot({ ...snapshot(), sets: undefined })).toThrow(/sets/);
    expect(() => parseSnapshot({ ...snapshot(), workouts: [{}] })).toThrow(/id/);
  });
  it("chunks", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 2)).toEqual([]);
  });
  // a fake paged server over a full snapshot: id order, `after` exclusive
  function pagedServer(full: SyncSnapshot) {
    return vi.fn<FetchLike>(async (url) => {
      const q = new URL(url).searchParams;
      const entity = q.get("entity") as SnapshotEntity;
      const limit = Number(q.get("limit"));
      const after = q.get("after");
      const all = [...(full[entity] as { id: string }[])].sort((a, b) => (a.id < b.id ? -1 : 1));
      const rest = after == null ? all : all.filter((r) => r.id > after);
      const rows = rest.slice(0, limit);
      const next = rest.length > limit ? rows.at(-1)!.id : null;
      return { status: 200, json: async () => ({ protocol: SYNC_PROTOCOL_VERSION, entity, rows, next, generatedAt: 7 }) };
    });
  }

  it("fetches every entity in fk order with bearer, and surfaces http errors", async () => {
    const f = pagedServer(snapshot());
    const snap = await fetchSnapshot(f, "https://x.org/", "tok");
    expect(f.mock.calls.map((c) => new URL(c[0]).searchParams.get("entity"))).toEqual([...SNAPSHOT_ENTITIES]);
    expect(f.mock.calls[0]![0]).toBe(`https://x.org/api/lift/sync/snapshot?entity=customExercises&limit=${SNAPSHOT_PAGE_MAX}`);
    expect(f.mock.calls[0]![1].headers.authorization).toBe("Bearer tok");
    expect(snap.sets.map((s) => s.id).sort()).toEqual(["s1", "s2"]);
    expect(snap.generatedAt).toBe(7);
    const bad = vi.fn<FetchLike>(async () => ({ status: 401, json: async () => ({}) }));
    await expect(fetchSnapshot(bad, "https://x.org", "tok")).rejects.toThrow(/unauthorized/);
    await expect(fetchSnapshot(f, "https://x.org", "")).rejects.toThrow(/token/);
  });

  it("pages through large entities and assembles the whole snapshot", async () => {
    const base = snapshot().sets[0]!;
    const sets = Array.from({ length: 25 }, (_, i) => ({ ...base, id: `s${String(i).padStart(3, "0")}` }));
    const full = snapshot({ sets });
    const f = pagedServer(full);
    const snap = await fetchSnapshot(f, "https://x.org", "tok", { pageSize: 10 });
    expect(snap.sets.map((s) => s.id)).toEqual(sets.map((s) => s.id));
    const setCalls = f.mock.calls.map((c) => new URL(c[0]).searchParams).filter((q) => q.get("entity") === "sets");
    expect(setCalls.map((q) => q.get("after"))).toEqual([null, "s009", "s019"]);
    // the assembled snapshot restores like a single-response one did
    expect(restorePlan(snap).counts).toEqual({ workouts: 1, sets: 25 });
  });

  it("refuses a page for the wrong entity, a stuck cursor and endless pages", async () => {
    const wrong = vi.fn<FetchLike>(async () => ({
      status: 200,
      json: async () => ({ protocol: SYNC_PROTOCOL_VERSION, entity: "sets", rows: [], next: null, generatedAt: 1 }),
    }));
    await expect(fetchSnapshot(wrong, "https://x.org", "tok")).rejects.toThrow(/expected customExercises/);
    const stuck = vi.fn<FetchLike>(async (url) => ({
      status: 200,
      json: async () => ({
        protocol: SYNC_PROTOCOL_VERSION,
        entity: new URL(url).searchParams.get("entity"),
        rows: [{ id: "a" }],
        next: "a",
        generatedAt: 1,
      }),
    }));
    await expect(fetchSnapshot(stuck, "https://x.org", "tok")).rejects.toThrow(/cursor/);
    let n = 0;
    const endless = vi.fn<FetchLike>(async (url) => ({
      status: 200,
      json: async () => ({
        protocol: SYNC_PROTOCOL_VERSION,
        entity: new URL(url).searchParams.get("entity"),
        rows: [{ id: `r${++n}` }],
        next: `r${n}`,
        generatedAt: 1,
      }),
    }));
    await expect(fetchSnapshot(endless, "https://x.org", "tok", { maxPages: 5 })).rejects.toThrow(/too many pages/);
    expect(endless).toHaveBeenCalledTimes(5);
  });

  it("validates pages", () => {
    const page = { protocol: SYNC_PROTOCOL_VERSION, entity: "sets", rows: [{ id: "s1" }], next: null, generatedAt: 1 };
    expect(parseSnapshotPage(page, "sets")).toBeTruthy();
    expect(() => parseSnapshotPage({ ...page, protocol: 2 }, "sets")).toThrow(/protocol/);
    expect(() => parseSnapshotPage({ ...page, rows: [{}] }, "sets")).toThrow(/id/);
    expect(() => parseSnapshotPage({ ...page, next: 5 }, "sets")).toThrow(/next/);
  });
});

describe("restore guard", () => {
  it("blocks on unsynced rows, and on refused rows unless the user agreed", () => {
    expect(restoreBlocker({ unsynced: 0, rejected: 0 })).toBeNull();
    expect(restoreBlocker({ unsynced: 2, rejected: 0 })).toMatch(/sync first: 2 unsynced changes/);
    expect(restoreBlocker({ unsynced: 1, rejected: 0, }, true)).toMatch(/sync first/);
    expect(restoreBlocker({ unsynced: 0, rejected: 3 })).toMatch(/3 changes were refused/);
    expect(restoreBlocker({ unsynced: 0, rejected: 1 })).toMatch(/1 change was refused/);
    expect(restoreBlocker({ unsynced: 0, rejected: 3 }, true)).toBeNull();
  });
});

describe("isRetryableRejection", () => {
  it("matches the server's missing-key and not-found reasons only", () => {
    expect(isRetryableRejection("payload.utcOffsetMin is missing")).toBe(true);
    expect(isRetryableRejection("workout m1w not found")).toBe(true);
    expect(isRetryableRejection("workout exercise m1we not found")).toBe(true);
    expect(isRetryableRejection("merge target pull-up not found")).toBe(true);
    expect(isRetryableRejection("payload.completed must be 0 or 1")).toBe(false);
    expect(isRetryableRejection("bench-press-barbell is a catalog exercise")).toBe(false);
    expect(isRetryableRejection(null)).toBe(false);
  });
});

describe("chart scale", () => {
  const box = { width: 110, height: 60, padLeft: 10, padRight: 0, padTop: 0, padBottom: 10 };
  it("maps extents to the box corners, y up", () => {
    const s = scalePoints(
      [
        { x: 0, y: 0 },
        { x: 10, y: 5 },
      ],
      box
    )!;
    expect(s.points).toEqual([
      { x: 10, y: 50 },
      { x: 110, y: 0 },
    ]);
    expect([s.minY, s.maxY]).toEqual([0, 5]);
    expect(polylinePoints(s.points)).toBe("10.0,50.0 110.0,0.0");
  });
  it("centers flat series and ignores non-finite points", () => {
    const s = scalePoints([{ x: 5, y: 3 }, { x: 5, y: NaN }], box)!;
    expect(s.points).toEqual([{ x: 60, y: 25 }]);
    expect(scalePoints([], box)).toBeNull();
  });
});

describe("unit formatting", () => {
  it("formats weights, volume and duration", () => {
    expect(formatKg(100, "kg")).toBe("100 kg");
    expect(formatKg(102.0582, "lb")).toBe("225 lb");
    expect(formatVolume(5000, "kg")).toBe("5000 kg");
    expect(formatVolume(12_345, "kg")).toBe("12.3k kg");
    expect(formatDuration(65 * 60_000)).toBe("1h 05m");
    expect(formatDuration(48 * 60_000)).toBe("48m");
  });
});
