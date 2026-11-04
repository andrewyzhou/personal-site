import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { ingest, looksLike } = vi.hoisted(() => ({ ingest: vi.fn(), looksLike: vi.fn() }));
vi.mock("@/lib/lift/ingest", () => ({ ingestShareText: (...a: unknown[]) => ingest(...a) }));
vi.mock("lift-core", () => ({ looksLikeShareText: (t: string) => looksLike(t) }));

import { POST } from "@/app/api/lift/telegram/route";

const fetchMock = vi.fn();

const DETAILS = [
  "logged push day · wed nov 4 · 1 exercise · 2 sets · 1,850 lb · watch: not linked yet",
  "bench press (barbell): 2×5 @ 185 lb · top e1rm 216 lb",
  "https://www.andrewzhou.org/lifts/q2W8vN0aZk1pL4xE",
].join("\n");

function update(body: unknown, secret: string | null = "hook-secret"): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (secret) headers["x-telegram-bot-api-secret-token"] = secret;
  return new Request("http://localhost/api/lift/telegram", { method: "POST", body: JSON.stringify(body), headers });
}

function msg(text: string, chatId = 42, extra: Record<string, unknown> = {}) {
  return { update_id: 1, message: { message_id: 7, chat: { id: chatId, type: "private" }, text, ...extra } };
}

function sentBodies() {
  return fetchMock.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string));
}

describe("POST /api/lift/telegram", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TELEGRAM_LIFT_WEBHOOK_SECRET = "hook-secret";
    process.env.TELEGRAM_LIFT_CHAT_IDS = "42, 99";
    process.env.TELEGRAM_LIFT_BOT_TOKEN = "123:abc";
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    looksLike.mockImplementation((t: string) => t.includes("Set 1"));
    ingest.mockResolvedValue({ status: "created", workoutId: "share-x", text: "logged push day · wed nov 4", details: DETAILS });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("401s on a missing/wrong secret, and when none is configured", async () => {
    expect((await POST(update(msg("hi"), null))).status).toBe(401);
    expect((await POST(update(msg("hi"), "wrong"))).status).toBe(401);
    delete process.env.TELEGRAM_LIFT_WEBHOOK_SECRET;
    expect((await POST(update(msg("hi"), "hook-secret"))).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("silently ignores chats outside the allowlist", async () => {
    const res = await POST(update(msg("Push Day\nSet 1: 185 lb × 5", 1000)));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, ignored: "chat not allowed" });
    expect(ingest).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows nobody when the allowlist is unset", async () => {
    delete process.env.TELEGRAM_LIFT_CHAT_IDS;
    await POST(update(msg("/start")));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers /start and chatter with help", async () => {
    const res = await POST(update(msg("/start")));
    expect(res.status).toBe(200);
    expect(ingest).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.telegram.org/bot123:abc/sendMessage");
    expect((init as RequestInit).method).toBe("POST");
    expect(sentBodies()[0]).toEqual({
      chat_id: 42,
      text: "share a workout to this chat to log it",
      reply_to_message_id: 7,
      allow_sending_without_reply: true,
    });
  });

  it("ingests a workout share and replies with the multi-line breakdown", async () => {
    const text = "Push Day\nSet 1: 185 lb × 5";
    const res = await POST(update(msg(text)));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, handled: "created", workoutId: "share-x" });
    expect(ingest).toHaveBeenCalledWith(text, { source: "telegram" });
    expect(sentBodies()[0]).toMatchObject({ chat_id: 42, text: DETAILS, reply_to_message_id: 7 });
  });

  it("says updated for an edited re-share", async () => {
    const details = DETAILS.replace(/^logged/, "updated");
    ingest.mockResolvedValueOnce({ status: "updated", workoutId: "share-x", text: "updated push day", details });
    const res = await POST(update(msg("Push Day\nSet 1: 185 lb × 6")));
    expect(await res.json()).toMatchObject({ handled: "updated" });
    expect(sentBodies()[0].text).toBe(details);
    expect(sentBodies()[0].text.toLowerCase()).not.toContain("strava");
  });

  it("falls back to the one-liner without details", async () => {
    ingest.mockResolvedValueOnce({ status: "duplicate", workoutId: "share-x", text: "already logged push day" });
    await POST(update(msg("Push Day\nSet 1: 185 lb × 5")));
    expect(sentBodies()[0].text).toBe("already logged push day");
  });

  it("caps a long reply without splitting an emoji", async () => {
    const details = "a" + "\u{1F4AA}".repeat(3000);
    ingest.mockResolvedValueOnce({ status: "created", workoutId: "share-x", text: "x", details });
    await POST(update(msg("Push Day\nSet 1: 185 lb × 5")));
    const sent: string = sentBodies()[0].text;
    expect(sent.length).toBeLessThanOrEqual(4000);
    expect(sent.endsWith("\u{1F4AA}…")).toBe(true);
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(sent)).toBe(false);
  });

  it("reads captions and edited messages", async () => {
    await POST(update({ edited_message: { message_id: 8, chat: { id: 99 }, caption: "Legs\nSet 1: 225 lb × 5" } }));
    expect(ingest).toHaveBeenCalledWith("Legs\nSet 1: 225 lb × 5", { source: "telegram" });
    expect(sentBodies()[0]).toMatchObject({ chat_id: 99, reply_to_message_id: 8 });
  });

  it("ignores updates without text", async () => {
    const res = await POST(update({ update_id: 3, message: { message_id: 1, chat: { id: 42 }, sticker: {} } }));
    expect(await res.json()).toMatchObject({ ignored: "no text" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still 200s and explains when ingest fails", async () => {
    ingest.mockRejectedValueOnce(new Error("db down"));
    const res = await POST(update(msg("Push Day\nSet 1: 185 lb × 5")));
    expect(res.status).toBe(200);
    expect(sentBodies()[0].text).toMatch(/^couldn't log that: something went wrong/);
  });

  it("explains an empty parse", async () => {
    ingest.mockResolvedValueOnce({ status: "empty", workoutId: null, text: "no exercises found in that text" });
    await POST(update(msg("Push Day\nSet 1: ???")));
    expect(sentBodies()[0].text).toBe("couldn't log that: no exercises found in that text");
  });

  it("still 200s when the reply itself fails", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 400 }));
    const res = await POST(update(msg("Push Day\nSet 1: 185 lb × 5")));
    expect(res.status).toBe(200);
  });

  it("200s on garbage json once authed", async () => {
    const res = await POST(
      new Request("http://localhost/api/lift/telegram", {
        method: "POST",
        body: "{",
        headers: { "x-telegram-bot-api-secret-token": "hook-secret" },
      })
    );
    expect(res.status).toBe(200);
  });
});
