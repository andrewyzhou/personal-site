// telegram webhook updates as the bot api sends them, for the photo flow.
// shapes follow https://core.telegram.org/bots/api#update (trimmed to the
// fields the route reads). file ids are made up; the test serves their bytes.

const CHAT = { id: 42, first_name: "owner", type: "private" };
const OWNER = { id: 42, is_bot: false, first_name: "owner" };
const BOT = { id: 9000, is_bot: true, first_name: "lift bot", username: "lift_bot" };

// 2026-11-04 19:10 pst (utc-8)
export const SENT_AT = 1793848200;

/** an image sent "as a file": telegram keeps the bytes (and exif) as they were */
export function documentUpdate(fileId: string, opts: { caption?: string; name?: string; mime?: string; date?: number } = {}) {
  return {
    update_id: 9001,
    message: {
      message_id: 101,
      from: OWNER,
      chat: CHAT,
      date: opts.date ?? SENT_AT,
      document: {
        file_name: opts.name ?? "IMG_2041.JPG",
        mime_type: opts.mime ?? "image/jpeg",
        file_id: fileId,
        file_unique_id: `u-${fileId}`,
        file_size: 1234,
        thumbnail: { file_id: `${fileId}-thumb`, file_unique_id: `u-${fileId}-thumb`, width: 320, height: 240, file_size: 900 },
      },
      ...(opts.caption ? { caption: opts.caption } : {}),
    },
  };
}

/** a compressed photo: every size telegram made, exif stripped */
export function photoUpdate(fileId: string, opts: { caption?: string; date?: number; messageId?: number } = {}) {
  return {
    update_id: 9002,
    message: {
      message_id: opts.messageId ?? 102,
      from: OWNER,
      chat: CHAT,
      date: opts.date ?? SENT_AT,
      photo: [
        { file_id: `${fileId}-s`, file_unique_id: `u-${fileId}-s`, file_size: 1200, width: 90, height: 68 },
        { file_id: `${fileId}-m`, file_unique_id: `u-${fileId}-m`, file_size: 15000, width: 320, height: 240 },
        { file_id: fileId, file_unique_id: `u-${fileId}`, file_size: 160000, width: 1280, height: 960 },
      ],
      ...(opts.caption ? { caption: opts.caption } : {}),
    },
  };
}

/** "undo" sent as a reply to the bot's message */
export function undoUpdate(botText: string) {
  return {
    update_id: 9003,
    message: {
      message_id: 103,
      from: OWNER,
      chat: CHAT,
      date: SENT_AT + 60,
      text: "undo",
      reply_to_message: { message_id: 104, from: BOT, chat: CHAT, date: SENT_AT + 5, text: botText },
    },
  };
}

/** the same photo with its caption edited afterwards */
export function editedPhotoUpdate(fileId: string, caption: string) {
  const { message } = photoUpdate(fileId, { caption });
  return { update_id: 9004, edited_message: { ...message, edit_date: SENT_AT + 120 } };
}
