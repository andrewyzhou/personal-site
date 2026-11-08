import { createHash } from "node:crypto";
import sharp from "sharp";
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { buildTiff, concatBytes, exifApp1 } from "@/lib/__tests__/fixtures/images";
import { documentUpdate, editedPhotoUpdate, photoUpdate, SENT_AT, undoUpdate } from "@/lib/__tests__/fixtures/telegram-photo-updates";
import { hasLocationMetadata } from "@/lib/image-strip";
import type { PhotoCandidate } from "@/lib/telegram-photo/match";
import type { NewPhotoRow } from "@/lib/telegram-photo/attach";

// the webhook end to end with fixture updates: the real route, matcher,
// telegram download (fetch stubbed), exif reader and sharp public copy. only
// the storage edges (neon rows, raw store, public bucket, republish) are an
// in-memory stand-in, and no message ever reaches telegram.

const store = vi.hoisted(() => ({
  activities: [] as PhotoCandidate[],
  photos: [] as (NewPhotoRow & { id: number })[],
  raw: new Map<string, Uint8Array>(),
  publicFiles: new Map<string, Uint8Array>(),
  refreshed: [] as number[],
  nextPath: 0,
}));

vi.mock("@/lib/lift/ingest", () => ({ ingestShareText: vi.fn() }));
vi.mock("@/lib/lift/query", () => ({ answerLiftQuestion: vi.fn(async () => "ask me about lifts") }));

vi.mock("@/lib/telegram-photo/deps", async () => {
  const { makePublicJpeg } = await import("@/lib/telegram-photo/public-image");
  const { readPhotoExif } = await import("@/app/api/admin/photos/exif");
  const { downloadTelegramFile } = await import("@/lib/lift/telegram");
  const { createHash: hash } = await import("node:crypto");
  return {
    telegramPhotoDeps: (token: string) => ({
      download: (fileId: string) => downloadTelegramFile(token, fileId),
      async candidates(q: { kind: string; fromMs?: number; toMs?: number; id?: number; from?: string; to?: string; beforeMs?: number }) {
        const all = store.activities;
        if (q.kind === "time") return all.filter((a) => a.startUtcMs >= q.fromMs! && a.startUtcMs <= q.toMs!);
        if (q.kind === "id") return all.filter((a) => a.id === q.id);
        if (q.kind === "dates") return all.filter((a) => a.localDate >= q.from! && a.localDate <= q.to!);
        const before = all.filter((a) => a.startUtcMs <= q.beforeMs!).sort((a, b) => b.startUtcMs - a.startUtcMs);
        return before.slice(0, 1);
      },
      async findByOriginal(sha: string) {
        const p = store.photos.find((x) => x.originalSha256 === sha);
        return p ? { photoId: p.id, activityId: p.activityId } : null;
      },
      async putOriginal(bytes: Uint8Array) {
        const sha = hash("sha256").update(bytes).digest("hex");
        store.raw.set(sha, bytes);
        return sha;
      },
      readExif: readPhotoExif,
      toPublic: makePublicJpeg,
      async putPublic(pathname: string, bytes: Uint8Array) {
        store.publicFiles.set(pathname, bytes);
        return `https://media.example/${pathname}`;
      },
      async insertPhoto(row: NewPhotoRow) {
        const id = store.photos.length + 1;
        store.photos.push({ ...row, id });
        return id;
      },
      async loadPhoto(id: number) {
        const p = store.photos.find((x) => x.id === id);
        return p ? { activityId: p.activityId, blobPathname: p.blobPathname } : null;
      },
      async deletePhoto(id: number) {
        store.photos = store.photos.filter((x) => x.id !== id);
      },
      async deletePublic(pathname: string) {
        store.publicFiles.delete(pathname);
      },
      async refresh(activityId: number) {
        store.refreshed.push(activityId);
      },
      timezone: () => "America/Los_Angeles",
      newPathname: () => `activities/photos/2026/test-${++store.nextPath}.jpg`,
    }),
  };
});

import { POST } from "@/app/api/lift/telegram/route";

// pacific standard time on these dates
const PST = -480;
function act(id: number, name: string, sportType: string, local: string, minutes: number): PhotoCandidate {
  return {
    id,
    name,
    sportType,
    startUtcMs: Date.parse(`${local}:00Z`) - PST * 60_000,
    elapsedS: minutes * 60,
    utcOffsetMin: PST,
    localDate: local.slice(0, 10),
    localTime: local.slice(11, 16),
  };
}

const files = new Map<string, Uint8Array>();
const fetchMock = vi.fn();
let plainJpeg: Uint8Array;

async function realJpeg(width: number, height: number): Promise<Uint8Array> {
  const buf = await sharp({ create: { width, height, channels: 3, background: { r: 30, g: 120, b: 200 } } })
    .jpeg({ quality: 80 })
    .toBuffer();
  return new Uint8Array(buf);
}

/** a phone-style jpeg with exif capture time and gps, as a file keeps it */
function withExif(jpeg: Uint8Array, dateTimeOriginal: string): Uint8Array {
  const tiff = buildTiff({ dateTimeOriginal, offsetTimeOriginal: "-08:00", lat: 37.8716, lng: -122.2727 });
  return concatBytes(jpeg.subarray(0, 2), exifApp1(tiff), jpeg.subarray(2));
}

function request(body: unknown): Request {
  return new Request("http://localhost/api/lift/telegram", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": "hook-secret" },
  });
}

function replies(): string[] {
  return fetchMock.mock.calls
    .filter(([url]) => String(url).endsWith("/sendMessage"))
    .map(([, init]) => JSON.parse((init as RequestInit).body as string).text as string);
}

async function send(body: unknown) {
  const res = await POST(request(body));
  expect(res.status).toBe(200);
  return res.json();
}

describe("telegram photo → activity", () => {
  beforeAll(async () => {
    plainJpeg = await realJpeg(3000, 2000);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TELEGRAM_LIFT_WEBHOOK_SECRET = "hook-secret";
    process.env.TELEGRAM_LIFT_CHAT_IDS = "42";
    process.env.TELEGRAM_LIFT_BOT_TOKEN = "123:abc";
    store.activities = [
      act(500, "Saturday hike", "Hike", "2026-11-02T09:00", 180),
      act(503, "Morning Run", "Run", "2026-11-04T07:10", 40),
      act(501, "Evening Ride", "Ride", "2026-11-04T17:00", 90),
      act(502, "Push day", "WeightTraining", "2026-11-04T18:45", 60),
    ];
    store.photos = [];
    store.raw.clear();
    store.publicFiles.clear();
    store.refreshed = [];
    store.nextPath = 0;
    files.clear();
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/getFile")) {
        const { file_id } = JSON.parse(init!.body as string);
        if (!files.has(file_id)) return new Response(JSON.stringify({ ok: false }), { status: 400 });
        return Response.json({ ok: true, result: { file_id, file_path: `documents/${file_id}.bin`, file_size: files.get(file_id)!.length } });
      }
      const file = /\/file\/bot123:abc\/documents\/(.+)\.bin$/.exec(url);
      if (file) return new Response(files.get(file[1]) as BodyInit, { status: 200 });
      if (url.endsWith("/sendMessage")) return Response.json({ ok: true });
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("a file with exif lands on the activity it was taken during, through the admin pipeline", async () => {
    const original = withExif(plainJpeg, "2026:11:04 17:45:10");
    files.set("doc-1", original);
    const out = await send(documentUpdate("doc-1"));
    expect(out).toMatchObject({ ok: true, handled: "photo-added", activityId: 501, photoId: 1 });

    // private original: the exact bytes, by hash
    const sha = createHash("sha256").update(original).digest("hex");
    expect(store.raw.get(sha)).toEqual(original);
    // row: private capture time + gps from the original, no public caption
    expect(store.photos).toHaveLength(1);
    const row = store.photos[0];
    expect(row).toMatchObject({ activityId: 501, originalSha256: sha, gpsLat: 37.8716, gpsLng: -122.2727, width: 2000, height: 1333 });
    expect(row.takenAt?.toISOString()).toBe("2026-11-05T01:45:10.000Z");
    // public copy: a downscaled jpeg with no metadata at all
    const pub = store.publicFiles.get(row.blobPathname)!;
    expect(pub[0]).toBe(0xff);
    expect(hasLocationMetadata(pub)).toBe(false);
    expect(Buffer.from(pub).includes(Buffer.from("Exif\0\0"))).toBe(false);
    expect((await sharp(pub).metadata()).width).toBe(2000);
    // pins + caches refreshed for that activity
    expect(store.refreshed).toEqual([501]);

    const [text] = replies();
    expect(text).toBe(
      [
        "added the photo to Evening Ride (ride, wed nov 4 17:00)",
        "https://www.andrewzhou.org/activities/501",
        "matched by the photo's time",
        'reply "undo" to this message to remove it · photo p1',
      ].join("\n"),
    );
    const sent = JSON.parse((fetchMock.mock.calls.find(([u]) => String(u).endsWith("/sendMessage"))![1] as RequestInit).body as string);
    expect(sent).toMatchObject({ chat_id: 42, reply_to_message_id: 101 });
  });

  it("says when a capture time fits two activities, and picks the closest", async () => {
    // 18:40: 10 min after the ride's end, 5 min before the lift
    files.set("doc-2", withExif(plainJpeg, "2026:11:04 18:40:00"));
    const out = await send(documentUpdate("doc-2"));
    expect(out).toMatchObject({ handled: "photo-added", activityId: 502 });
    expect(replies()[0]).toContain("ambiguous: also fits Evening Ride (ride, wed nov 4 17:00). picked the closest");
  });

  it("a compressed photo (no exif) follows its caption: an id, then a date", async () => {
    files.set("ph-1", await realJpeg(1280, 960));
    expect(await send(photoUpdate("ph-1", { caption: "#503" }))).toMatchObject({ handled: "photo-added", activityId: 503 });
    expect(replies()[0]).toContain("matched by the id in the caption");
    expect(store.photos[0]).toMatchObject({ takenAt: null, gpsLat: null, width: 1280, height: 960 });

    files.set("ph-2", await realJpeg(1280, 961));
    expect(await send(photoUpdate("ph-2", { caption: "11/4 night" }))).toMatchObject({ activityId: 502 });
    expect(replies()[1]).toContain("matched by the date in the caption");
    expect(replies()[1]).toContain("ambiguous: also fits");
  });

  it("with nothing to go on, takes the latest activity", async () => {
    files.set("ph-3", await realJpeg(800, 600));
    expect(await send(photoUpdate("ph-3"))).toMatchObject({ activityId: 502 });
    expect(replies()[0]).toContain("no time in the photo or caption, so the latest activity");
    // sent before the lift started: the ride is the latest
    files.set("ph-4", await realJpeg(800, 601));
    const early = SENT_AT - 60 * 60; // 18:10
    expect(await send(photoUpdate("ph-4", { date: early, messageId: 120 }))).toMatchObject({ activityId: 501 });
  });

  it("undo removes the photo and its public copy, keeps the original, and is safe to repeat", async () => {
    files.set("doc-1", withExif(plainJpeg, "2026:11:04 17:45:10"));
    await send(documentUpdate("doc-1"));
    const [added] = replies();
    const pathname = store.photos[0].blobPathname;

    expect(await send(undoUpdate(added))).toMatchObject({ handled: "undo" });
    expect(store.photos).toEqual([]);
    expect(store.publicFiles.has(pathname)).toBe(false);
    expect(store.raw.size).toBe(1);
    expect(store.refreshed).toEqual([501, 501]);
    expect(replies()[1]).toBe("removed the photo from https://www.andrewzhou.org/activities/501");

    await send(undoUpdate(added));
    expect(replies()[2]).toBe("that photo is already gone");
    await send(undoUpdate("logged push day · wed nov 4"));
    expect(replies()[3]).toMatch(/^nothing to undo/);
  });

  it("a retried update doesn't add the photo twice", async () => {
    files.set("doc-1", withExif(plainJpeg, "2026:11:04 17:45:10"));
    await send(documentUpdate("doc-1"));
    expect(await send(documentUpdate("doc-1"))).toMatchObject({ handled: "photo-duplicate", activityId: 501, photoId: 1 });
    expect(store.photos).toHaveLength(1);
    expect(replies()[1]).toMatch(/^already added: https:\/\/www\.andrewzhou\.org\/activities\/501\n/);
  });

  it("heic it can't convert: keeps the original privately and says how to resend", async () => {
    // an ftyp box with heic brands, then a free box (a zero-size box sends the exif reader into a loop)
    const enc = (s: string) => new TextEncoder().encode(s);
    const heic = concatBytes([0, 0, 0, 24], enc("ftypheic"), [0, 0, 0, 0], enc("mif1heic"), [0, 0, 0, 16], enc("free"), new Uint8Array(8));
    files.set("doc-heic", heic);
    expect(await send(documentUpdate("doc-heic", { name: "IMG_1.HEIC", mime: "image/heic" }))).toMatchObject({
      handled: "photo-unsupported",
    });
    expect(store.raw.size).toBe(1);
    expect(store.photos).toEqual([]);
    expect(replies()[0]).toMatch(/heic can't be converted on the server.*the original was kept privately/);
  });

  it("ignores other chats, non-image files and edited captions", async () => {
    files.set("doc-1", withExif(plainJpeg, "2026:11:04 17:45:10"));
    const stranger = documentUpdate("doc-1");
    stranger.message.chat = { ...stranger.message.chat, id: 7 };
    expect(await send(stranger)).toMatchObject({ ignored: "chat not allowed" });

    const pdf = documentUpdate("doc-pdf", { name: "plan.pdf", mime: "application/pdf" });
    expect(await send(pdf)).toMatchObject({ ignored: "no text" });

    expect(await send(editedPhotoUpdate("ph-1", "11/4 night"))).toMatchObject({ ignored: "no text" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(store.photos).toEqual([]);
  });
});
