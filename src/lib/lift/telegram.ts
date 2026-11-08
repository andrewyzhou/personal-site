// minimal telegram bot helpers for the lift bot webhook. plain fetch so tests can stub it.

import { truncateText } from "./summary";

export interface TelegramPhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

export interface TelegramDocument {
  file_id: string;
  file_unique_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

export interface TelegramMessage {
  message_id: number;
  chat: { id: number; type?: string };
  /** unix seconds */
  date?: number;
  from?: { id: number; is_bot?: boolean };
  text?: string;
  caption?: string;
  /** a compressed photo, every size telegram made of it (exif is gone) */
  photo?: TelegramPhotoSize[];
  /** a file as sent (an image sent "as a file" keeps its exif) */
  document?: TelegramDocument;
  reply_to_message?: TelegramMessage;
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

/** the text of a message/edited_message; null for anything else (images go through extractIncomingImage) */
export function extractIncomingText(update: TelegramUpdate): IncomingText | null {
  const msg = update?.message ?? update?.edited_message;
  if (!msg || typeof msg.chat?.id !== "number" || typeof msg.message_id !== "number") return null;
  // re-captioning an image that was already handled isn't a new question
  if (!update.message && (msg.photo || msg.document)) return null;
  const text = typeof msg.text === "string" ? msg.text : typeof msg.caption === "string" ? msg.caption : null;
  if (!text || !text.trim()) return null;
  return { chatId: msg.chat.id, messageId: msg.message_id, text };
}

export interface IncomingImage {
  chatId: number;
  messageId: number;
  sentAt: Date;
  caption: string | null;
  kind: "photo" | "document";
  fileId: string;
  fileUniqueId: string;
  fileName: string | null;
  mimeType: string | null;
  size: number | null;
  width: number | null;
  height: number | null;
}

const IMAGE_NAME_RE = /\.(jpe?g|png|webp|heic|heif)$/i;

/**
 * a new message carrying an image: the largest size of a compressed photo, or
 * an image document. edits are ignored (re-captioning must not add it twice).
 */
export function extractIncomingImage(update: TelegramUpdate): IncomingImage | null {
  const msg = update?.message;
  if (!msg || typeof msg.chat?.id !== "number" || typeof msg.message_id !== "number") return null;
  const base = {
    chatId: msg.chat.id,
    messageId: msg.message_id,
    sentAt: new Date(typeof msg.date === "number" ? msg.date * 1000 : Date.now()),
    caption: typeof msg.caption === "string" && msg.caption.trim() ? msg.caption : null,
  };
  const doc = msg.document;
  if (doc && typeof doc.file_id === "string") {
    const isImage = (doc.mime_type ?? "").startsWith("image/") || IMAGE_NAME_RE.test(doc.file_name ?? "");
    if (!isImage) return null;
    return {
      ...base,
      kind: "document",
      fileId: doc.file_id,
      fileUniqueId: doc.file_unique_id,
      fileName: doc.file_name ?? null,
      mimeType: doc.mime_type ?? null,
      size: doc.file_size ?? null,
      width: null,
      height: null,
    };
  }
  if (Array.isArray(msg.photo) && msg.photo.length) {
    const largest = [...msg.photo].sort((a, b) => b.width * b.height - a.width * a.height)[0];
    return {
      ...base,
      kind: "photo",
      fileId: largest.file_id,
      fileUniqueId: largest.file_unique_id,
      fileName: null,
      mimeType: "image/jpeg",
      size: largest.file_size ?? null,
      width: largest.width,
      height: largest.height,
    };
  }
  return null;
}

export interface IncomingUndo {
  chatId: number;
  messageId: number;
  /** the text of the bot message being answered */
  repliedText: string;
}

/** "undo" sent as a reply to one of the bot's own messages */
export function extractUndo(update: TelegramUpdate): IncomingUndo | null {
  const msg = update?.message;
  if (!msg || typeof msg.chat?.id !== "number" || typeof msg.message_id !== "number") return null;
  if (!/^\/?undo[.!]?$/i.test((msg.text ?? "").trim())) return null;
  const replied = msg.reply_to_message;
  if (!replied || replied.from?.is_bot !== true || typeof replied.text !== "string") return null;
  return { chatId: msg.chat.id, messageId: msg.message_id, repliedText: replied.text };
}

// the bot api serves files up to 20 mb
export const TELEGRAM_MAX_FILE_BYTES = 20_000_000;

/** the bytes of a file the bot received (getFile, then the file url) */
export async function downloadTelegramFile(token: string, fileId: string): Promise<Uint8Array> {
  const res = await fetch(`https://api.telegram.org/bot${token}/getFile`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ file_id: fileId }),
  });
  const body = (await res.json().catch(() => null)) as { ok?: boolean; result?: { file_path?: string; file_size?: number } } | null;
  const filePath = body?.result?.file_path;
  if (!res.ok || !body?.ok || !filePath) throw new Error(`telegram getFile ${res.status}`);
  if ((body.result?.file_size ?? 0) > TELEGRAM_MAX_FILE_BYTES) throw new Error("telegram file too large");
  const file = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`);
  if (!file.ok) throw new Error(`telegram file download ${file.status}`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length > TELEGRAM_MAX_FILE_BYTES) throw new Error("telegram file too large");
  return bytes;
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
