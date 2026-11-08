import { NextResponse } from "next/server";
import { looksLikeShareText } from "lift-core";
import { ingestShareText } from "@/lib/lift/ingest";
import { answerLiftQuestion } from "@/lib/lift/query";
import { safeEqual } from "@/lib/lift/auth";
import {
  extractIncomingImage,
  extractIncomingText,
  extractUndo,
  parseChatAllowlist,
  sendTelegramMessage,
  type TelegramUpdate,
} from "@/lib/lift/telegram";
import { attachTelegramPhoto, undoTelegramPhoto } from "@/lib/telegram-photo/attach";
import { telegramPhotoDeps } from "@/lib/telegram-photo/deps";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function isShare(text: string): boolean {
  try {
    return looksLikeShareText(text);
  } catch {
    return false;
  }
}

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

  // an image (photo or image file) goes on an activity; "undo" in reply to the
  // bot takes it off again; any other text is a workout share or a question
  const attached = extractIncomingImage(update);
  // a workout share pasted as an image caption is still a share
  const image = attached && !(attached.caption && isShare(attached.caption)) ? attached : null;
  const undo = image ? null : extractUndo(update);
  const incoming = image || undo ? null : extractIncomingText(update);
  const from = image ?? undo ?? incoming;
  if (!from) return NextResponse.json({ ok: true, ignored: "no text" });

  // unknown chats get silence, not a reply that confirms the bot exists
  if (!parseChatAllowlist(process.env.TELEGRAM_LIFT_CHAT_IDS).has(String(from.chatId))) {
    log.warn("api:lift/telegram", `ignored chat ${from.chatId}`);
    return NextResponse.json({ ok: true, ignored: "chat not allowed" });
  }

  const token = process.env.TELEGRAM_LIFT_BOT_TOKEN;
  const reply = async (text: string) => {
    if (!token) {
      log.warn("api:lift/telegram", "TELEGRAM_LIFT_BOT_TOKEN unset, not replying");
      return;
    }
    try {
      await sendTelegramMessage(token, from.chatId, text, from.messageId);
    } catch (error) {
      log.error("api:lift/telegram", "reply failed", error);
    }
  };

  if (image) {
    if (!token) {
      log.warn("api:lift/telegram", "TELEGRAM_LIFT_BOT_TOKEN unset, can't download the photo");
      return NextResponse.json({ ok: true, ignored: "no token" });
    }
    try {
      const result = await attachTelegramPhoto(image, telegramPhotoDeps(token));
      await reply(result.text);
      return NextResponse.json({
        ok: true,
        handled: `photo-${result.status}`,
        ...("activityId" in result ? { activityId: result.activityId, photoId: result.photoId } : {}),
      });
    } catch (error) {
      log.error("api:lift/telegram", "photo failed", error);
      await reply("couldn't add that photo: something went wrong, try sending it again");
      return NextResponse.json({ ok: true, handled: "error" });
    }
  }

  if (undo) {
    try {
      await reply(await undoTelegramPhoto(undo.repliedText, telegramPhotoDeps(token ?? "")));
      return NextResponse.json({ ok: true, handled: "undo" });
    } catch (error) {
      log.error("api:lift/telegram", "undo failed", error);
      await reply("couldn't undo that: something went wrong, try again in a bit");
      return NextResponse.json({ ok: true, handled: "error" });
    }
  }

  if (!incoming) return NextResponse.json({ ok: true, ignored: "no text" });

  let isWorkout = false;
  try {
    isWorkout = looksLikeShareText(incoming.text);
  } catch (error) {
    log.error("api:lift/telegram", "detect failed", error);
  }
  // anything that isn't a workout share is a question (or help)
  if (!isWorkout) {
    try {
      await reply(await answerLiftQuestion(incoming.text));
      return NextResponse.json({ ok: true, handled: "query" });
    } catch (error) {
      log.error("api:lift/telegram", "query failed", error);
      await reply("couldn't answer that: something went wrong, try again in a bit");
      return NextResponse.json({ ok: true, handled: "error" });
    }
  }

  try {
    const result = await ingestShareText(incoming.text, { source: "telegram" });
    await reply(result.status === "empty" ? `couldn't log that: ${result.text}` : result.details || result.text);
    return NextResponse.json({ ok: true, handled: result.status, workoutId: result.workoutId });
  } catch (error) {
    log.error("api:lift/telegram", "ingest failed", error);
    // db/driver errors can carry connection details, so they stay in the logs
    await reply("couldn't log that: something went wrong (the raw text was not saved, try sharing again)");
    return NextResponse.json({ ok: true, handled: "error" });
  }
}
