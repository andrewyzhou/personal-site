// a photo sent to the bot → a photo on the right activity, through the same
// pipeline as an admin upload: the untouched original into the private raw
// store, exif read from it into the private taken_at/gps columns, a
// metadata-free ≤2000px jpeg as the public copy, and pins written by
// republish (fog-aware). "undo" in reply to the bot's message removes it again.

import { sniffImageFormat, type ImageFormat } from "@/lib/image-strip";
import { sha256Hex } from "@/lib/raw-store";
import { sportTypeLabel } from "@/lib/sport-types";
import { resolveTakenAt, type PhotoExifMeta } from "@/app/api/admin/photos/exif";
import { MAX_ORIGINAL_BYTES } from "@/app/api/admin/photos/photo-input";
import { formatLocalDay, SITE_URL } from "@/lib/lift/summary";
import { utcToLocal } from "@/lib/lift/time";
import type { IncomingImage } from "@/lib/lift/telegram";
import { log } from "@/lib/log";
import {
  matchByCaptionDate,
  matchByCaptureTime,
  matchLatest,
  parseCaption,
  type CaptionHint,
  type MatchedBy,
  type PhotoCandidate,
  type PhotoMatch,
} from "./match";

const DAY_MS = 86_400_000;

export type CandidateQuery =
  | { kind: "time"; fromMs: number; toMs: number }
  | { kind: "id"; id: number }
  | { kind: "dates"; from: string; to: string }
  | { kind: "latest"; beforeMs: number };

export interface PublicImage {
  bytes: Uint8Array;
  width: number;
  height: number;
}

export interface NewPhotoRow {
  activityId: number;
  blobUrl: string;
  blobPathname: string;
  width: number;
  height: number;
  originalSha256: string | null;
  takenAt: Date | null;
  gpsLat: number | null;
  gpsLng: number | null;
}

export interface PhotoDeps {
  download(fileId: string): Promise<Uint8Array>;
  candidates(q: CandidateQuery): Promise<PhotoCandidate[]>;
  /** a photo row already holding this original, so a retried update doesn't add it twice */
  findByOriginal(sha256: string): Promise<{ photoId: number; activityId: number } | null>;
  /** null when the private store isn't configured (the admin path also goes on without it) */
  putOriginal(bytes: Uint8Array, format: ImageFormat, image: IncomingImage): Promise<string | null>;
  readExif(bytes: Uint8Array): Promise<PhotoExifMeta>;
  toPublic(bytes: Uint8Array): Promise<PublicImage>;
  putPublic(pathname: string, bytes: Uint8Array): Promise<string>;
  insertPhoto(row: NewPhotoRow): Promise<number>;
  loadPhoto(photoId: number): Promise<{ activityId: number; blobPathname: string } | null>;
  deletePhoto(photoId: number): Promise<void>;
  deletePublic(pathname: string): Promise<void>;
  /** pins + cache, after the row change; failures leave pins stale until the next rebuild */
  refresh(activityId: number): Promise<void>;
  timezone(): string;
  newPathname(): string;
}

export class UnsupportedImageError extends Error {}

export type AttachResult =
  | { status: "added"; photoId: number; activityId: number; text: string }
  | { status: "duplicate"; photoId: number; activityId: number; text: string }
  | { status: "no-activity"; text: string }
  | { status: "unsupported"; text: string };

/** where the photo goes, trying capture time, then caption, then the latest activity */
export async function matchIncomingPhoto(
  exif: PhotoExifMeta,
  hint: CaptionHint,
  sentAt: Date,
  deps: Pick<PhotoDeps, "candidates">,
): Promise<{ match: PhotoMatch; candidates: PhotoCandidate[] } | null> {
  if (exif.takenAt || exif.takenAtLocal) {
    // a wall clock without an offset can be up to a day off as an instant; the matcher reads it per activity
    const t = exif.takenAt ? Date.parse(exif.takenAt) : Date.parse(`${exif.takenAtLocal}Z`);
    if (Number.isFinite(t)) {
      const candidates = await deps.candidates({ kind: "time", fromMs: t - 2 * DAY_MS, toMs: t + DAY_MS });
      const match = matchByCaptureTime(exif, candidates);
      if (match) return { match, candidates };
    }
  }
  if (hint.id !== null) {
    const candidates = await deps.candidates({ kind: "id", id: hint.id });
    if (candidates.some((c) => c.id === hint.id)) return { match: { activityId: hint.id, by: "caption-id", alsoMatched: [] }, candidates };
  }
  if (hint.date) {
    const next = new Date(Date.parse(`${hint.date}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);
    const candidates = await deps.candidates({ kind: "dates", from: hint.date, to: next });
    const match = matchByCaptionDate(hint, candidates);
    if (match) return { match, candidates };
  }
  const candidates = await deps.candidates({ kind: "latest", beforeMs: sentAt.getTime() });
  const match = matchLatest(sentAt.getTime(), candidates);
  return match ? { match, candidates } : null;
}

const BY_TEXT: Record<MatchedBy, string> = {
  "photo-time": "by the photo's time",
  "caption-id": "by the id in the caption",
  "caption-date": "by the date in the caption",
  latest: "no time in the photo or caption, so the latest activity",
};

function describe(c: PhotoCandidate): string {
  const name = c.name.replace(/\s+/g, " ").trim() || sportTypeLabel(c.sportType);
  return `${name} (${sportTypeLabel(c.sportType)}, ${formatLocalDay(c.localDate)} ${c.localTime})`;
}

const UNDO_TOKEN_RE = /\bphoto p(\d{1,15})\b/;

/** the bot's reply; its last line carries the token "undo" reads back */
export function formatAddedReply(
  photoId: number,
  activity: PhotoCandidate,
  match: PhotoMatch,
  others: readonly PhotoCandidate[],
  hint: CaptionHint,
): string {
  const lines = [`added the photo to ${describe(activity)}`, `${SITE_URL}/activities/${activity.id}`, `matched ${BY_TEXT[match.by]}`];
  if (others.length) {
    lines.push(`ambiguous: also fits ${others.map(describe).join("; ")}. picked the closest`);
  }
  if (hint.id !== null && match.by !== "caption-id" && hint.id !== activity.id) {
    lines.push(`(the caption said #${hint.id}, but the photo's time puts it here)`);
  }
  lines.push(`reply "undo" to this message to remove it · photo p${photoId}`);
  return lines.join("\n");
}

/** the photo id an "undo" reply points at, from the bot message it answers */
export function undoTarget(repliedText: string): number | null {
  const m = UNDO_TOKEN_RE.exec(repliedText);
  return m ? Number(m[1]) : null;
}

export async function attachTelegramPhoto(image: IncomingImage, deps: PhotoDeps): Promise<AttachResult> {
  const bytes = await deps.download(image.fileId);
  const format = sniffImageFormat(bytes);
  if (!format) return { status: "unsupported", text: "couldn't add that: it isn't an image i can read (jpeg, png, webp or heic)" };
  if (bytes.length > MAX_ORIGINAL_BYTES) return { status: "unsupported", text: "couldn't add that: the file is too large" };

  const sha = sha256Hex(bytes);
  const seen = await deps.findByOriginal(sha);
  if (seen) {
    return {
      status: "duplicate",
      ...seen,
      text: `already added: ${SITE_URL}/activities/${seen.activityId}\nreply "undo" to this message to remove it · photo p${seen.photoId}`,
    };
  }

  // raw data first: the original is kept even when the public copy can't be made
  const originalSha = await deps.putOriginal(bytes, format, image);
  const exif = await deps.readExif(bytes);

  let publicImage: PublicImage;
  try {
    publicImage = await deps.toPublic(bytes);
  } catch (error) {
    if (!(error instanceof UnsupportedImageError)) throw error;
    log.warn("telegram:photo", `no public copy for ${format}: ${error.message}`);
    return {
      status: "unsupported",
      text:
        format === "heic"
          ? "couldn't add that: heic can't be converted on the server. send it as a photo, or export it as a jpeg and send that as a file (keeps the time)." +
            (originalSha ? " the original was kept privately." : "")
          : "couldn't add that: the image couldn't be decoded",
    };
  }

  const today = utcToLocal(image.sentAt, deps.timezone()).slice(0, 10);
  const hint = parseCaption(image.caption, today);
  const found = await matchIncomingPhoto(exif, hint, image.sentAt, deps);
  if (!found) return { status: "no-activity", text: "couldn't add that: there's no activity to put it on yet" };
  const { match, candidates } = found;
  const activity = candidates.find((c) => c.id === match.activityId)!;

  const pathname = deps.newPathname();
  const url = await deps.putPublic(pathname, publicImage.bytes);
  const takenAt = resolveTakenAt(exif, activity.utcOffsetMin);
  const photoId = await deps.insertPhoto({
    activityId: activity.id,
    blobUrl: url,
    blobPathname: pathname,
    width: publicImage.width,
    height: publicImage.height,
    originalSha256: originalSha,
    takenAt: takenAt ? new Date(takenAt) : null,
    gpsLat: exif.gps?.lat ?? null,
    gpsLng: exif.gps?.lng ?? null,
  });
  await deps.refresh(activity.id);
  log.info("telegram:photo", `photo ${photoId} → activity ${activity.id} (${match.by}${match.alsoMatched.length ? ", ambiguous" : ""})`);

  const others = match.alsoMatched.map((id) => candidates.find((c) => c.id === id)).filter((c): c is PhotoCandidate => !!c);
  return { status: "added", photoId, activityId: activity.id, text: formatAddedReply(photoId, activity, match, others, hint) };
}

export async function undoTelegramPhoto(repliedText: string, deps: PhotoDeps): Promise<string> {
  const photoId = undoTarget(repliedText);
  if (photoId === null) return 'nothing to undo: reply "undo" to the message where i added a photo';
  const row = await deps.loadPhoto(photoId);
  if (!row) return "that photo is already gone";
  await deps.deletePhoto(photoId);
  // the public copy is derived and goes with the row; the private original stays
  try {
    await deps.deletePublic(row.blobPathname);
  } catch (error) {
    log.warn("telegram:photo", `public copy delete failed: ${row.blobPathname}`, error);
  }
  await deps.refresh(row.activityId);
  log.info("telegram:photo", `undo: removed photo ${photoId} from activity ${row.activityId}`);
  return `removed the photo from ${SITE_URL}/activities/${row.activityId}`;
}
