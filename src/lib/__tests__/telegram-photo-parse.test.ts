import { describe, expect, it } from "vitest";
import { extractIncomingImage, extractIncomingText, extractUndo } from "@/lib/lift/telegram";
import { undoTarget } from "@/lib/telegram-photo/attach";
import { documentUpdate, editedPhotoUpdate, photoUpdate, SENT_AT, undoUpdate } from "./fixtures/telegram-photo-updates";

describe("telegram image updates", () => {
  it("takes the largest size of a compressed photo", () => {
    expect(extractIncomingImage(photoUpdate("p1", { caption: "11/4" }))).toMatchObject({
      chatId: 42,
      messageId: 102,
      kind: "photo",
      fileId: "p1",
      width: 1280,
      caption: "11/4",
      sentAt: new Date(SENT_AT * 1000),
    });
  });

  it("takes image documents only", () => {
    expect(extractIncomingImage(documentUpdate("d1"))).toMatchObject({ kind: "document", fileId: "d1", fileName: "IMG_2041.JPG" });
    expect(extractIncomingImage(documentUpdate("d2", { name: "IMG_9.HEIC", mime: "application/octet-stream" }))?.fileId).toBe("d2");
    expect(extractIncomingImage(documentUpdate("d3", { name: "notes.pdf", mime: "application/pdf" }))).toBeNull();
  });

  it("ignores edits of image messages entirely", () => {
    const edited = editedPhotoUpdate("p1", "#12");
    expect(extractIncomingImage(edited)).toBeNull();
    expect(extractIncomingText(edited)).toBeNull();
  });
});

describe("undo", () => {
  it("only counts as a reply to the bot", () => {
    expect(extractUndo(undoUpdate("added the photo … photo p7"))).toMatchObject({ chatId: 42, repliedText: "added the photo … photo p7" });
    const toSelf = undoUpdate("x");
    toSelf.message.reply_to_message.from = { ...toSelf.message.reply_to_message.from, is_bot: false };
    expect(extractUndo(toSelf)).toBeNull();
    const plain = undoUpdate("x") as { message: Record<string, unknown> };
    delete plain.message.reply_to_message;
    expect(extractUndo(plain as never)).toBeNull();
  });

  it("reads the photo token back from the bot's message", () => {
    expect(undoTarget('added the photo to x\nreply "undo" to this message to remove it · photo p1234')).toBe(1234);
    expect(undoTarget("logged push day")).toBeNull();
  });
});
