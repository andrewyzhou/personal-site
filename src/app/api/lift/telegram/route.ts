import { NextResponse } from "next/server";
import { looksLikeStrongText } from "lift-core";
import { ingestStrongText } from "@/lib/lift/ingest";
import { safeEqual } from "@/lib/lift/auth";
import {
  extractIncomingText,
  parseChatAllowlist,
  sendTelegramMessage,
  type TelegramUpdate,
} from "@/lib/lift/telegram";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const HELP_TEXT = "share a workout from strong to this chat to log it";

// once the secret checks out this always answers 200: telegram retries any
// non-2xx with backoff, and a retry storm of the same bad update helps nobody.
export async function POST(request: Request) {
  const secret = process.env.TELEGRAM_LIFT_WEBHOOK_SECRET;
  if (!safeEqual(request.headers.get("x-telegram-bot-api-secret-token"), secret)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let update: TelegramUpdate;
  try {
    update = await request.json();
  } catch {
    return NextResponse.json({ ok: true, ignored: "bad json" });
  }

  const incoming = extractIncomingText(update);
  if (!incoming) return NextResponse.json({ ok: true, ignored: "no text" });

  // unknown chats get silence, not a reply that confirms the bot exists
  if (!parseChatAllowlist(process.env.TELEGRAM_LIFT_CHAT_IDS).has(String(incoming.chatId))) {
    log.warn("api:lift/telegram", `ignored chat ${incoming.chatId}`);
    return NextResponse.json({ ok: true, ignored: "chat not allowed" });
  }

  const token = process.env.TELEGRAM_LIFT_BOT_TOKEN;
  const reply = async (text: string) => {
    if (!token) {
      log.warn("api:lift/telegram", "TELEGRAM_LIFT_BOT_TOKEN unset, not replying");
      return;
    }
    try {
      await sendTelegramMessage(token, incoming.chatId, text, incoming.messageId);
    } catch (error) {
      log.error("api:lift/telegram", "reply failed", error);
    }
  };

  let isWorkout = false;
  try {
    isWorkout = looksLikeStrongText(incoming.text);
  } catch (error) {
    log.error("api:lift/telegram", "detect failed", error);
  }
  if (!isWorkout) {
    await reply(HELP_TEXT);
    return NextResponse.json({ ok: true, handled: "help" });
  }

  try {
    const result = await ingestStrongText(incoming.text, { source: "telegram" });
    await reply(result.status === "empty" ? `couldn't log that: ${result.text}` : result.text);
    return NextResponse.json({ ok: true, handled: result.status, workoutId: result.workoutId });
  } catch (error) {
    log.error("api:lift/telegram", "ingest failed", error);
    // db/driver errors can carry connection details, so they stay in the logs
    await reply("couldn't log that: something went wrong (the raw text was not saved, try sharing again)");
    return NextResponse.json({ ok: true, handled: "error" });
  }
}
