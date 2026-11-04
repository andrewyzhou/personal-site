// minimal telegram bot helpers for the lift bot webhook. plain fetch so tests can stub it.

import { truncateText } from "./summary";

export interface TelegramMessage {
  message_id: number;
  chat: { id: number; type?: string };
  text?: string;
  caption?: string;
}

export interface TelegramUpdate {
  update_id?: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
}

export interface IncomingText {
  chatId: number;
  messageId: number;
  text: string;
}

/** the text (or photo caption) of a message/edited_message; null for anything else */
export function extractIncomingText(update: TelegramUpdate): IncomingText | null {
  const msg = update?.message ?? update?.edited_message;
  if (!msg || typeof msg.chat?.id !== "number" || typeof msg.message_id !== "number") return null;
  const text = typeof msg.text === "string" ? msg.text : typeof msg.caption === "string" ? msg.caption : null;
  if (!text || !text.trim()) return null;
  return { chatId: msg.chat.id, messageId: msg.message_id, text };
}

/** comma-separated chat id allowlist; empty/unset allows nobody */
export function parseChatAllowlist(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

// telegram caps messages at 4096 chars
const MAX_TEXT = 4000;

export async function sendTelegramMessage(
  token: string,
  chatId: number,
  text: string,
  replyTo?: number
): Promise<void> {
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text: truncateText(text, MAX_TEXT),
  };
  if (replyTo != null) {
    body.reply_to_message_id = replyTo;
    // still send if the original message was deleted in the meantime
    body.allow_sending_without_reply = true;
  }
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`telegram sendMessage ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}
