// the real dependencies of attachTelegramPhoto: telegram downloads, neon rows,
// the private raw store, the public bucket, sharp for the public copy, and
// republish for pins. split out so tests can swap in an in-memory set.

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { and, asc, desc, eq, gte, lte, max } from "drizzle-orm";
import { activities, activityPhotos, getDb } from "@/lib/db";
import { invalidateCache } from "@/lib/cache";
import { FORMAT_CONTENT_TYPES } from "@/lib/image-strip";
import { getRawStore, isRawStoreConfigured } from "@/lib/raw-store";
import { r2Delete, r2Put } from "@/lib/r2";
import { republish } from "@/lib/republish";
import { readPhotoExif } from "@/app/api/admin/photos/exif";
import { liftTimezone } from "@/lib/lift/time";
import { downloadTelegramFile } from "@/lib/lift/telegram";
import { log } from "@/lib/log";
import type { PhotoDeps } from "./attach";
import { makePublicJpeg } from "./public-image";

const candidateColumns = {
  id: activities.id,
  name: activities.name,
  sportType: activities.sportType,
  startDateUtc: activities.startDateUtc,
  elapsedS: activities.elapsedTimeS,
  utcOffsetMin: activities.utcOffsetMin,
  localDate: activities.localDate,
  localTime: activities.localTime,
};

export function telegramPhotoDeps(token = process.env.TELEGRAM_LIFT_BOT_TOKEN ?? ""): PhotoDeps {
  return {
    download: (fileId) => downloadTelegramFile(token, fileId),
    async candidates(q) {
      const db = getDb();
      const visible = eq(activities.hidden, false);
      const base = db.select(candidateColumns).from(activities);
      const rows =
        q.kind === "time"
          ? await base.where(and(visible, gte(activities.startDateUtc, new Date(q.fromMs)), lte(activities.startDateUtc, new Date(q.toMs))))
          : q.kind === "id"
            ? await base.where(and(visible, eq(activities.id, q.id)))
            : q.kind === "dates"
              ? await base.where(and(visible, gte(activities.localDate, q.from), lte(activities.localDate, q.to))).orderBy(asc(activities.startDateUtc))
              : await base
                  .where(and(visible, lte(activities.startDateUtc, new Date(q.beforeMs))))
                  .orderBy(desc(activities.startDateUtc))
                  .limit(1);
      return rows.map((r) => ({ ...r, startUtcMs: r.startDateUtc.getTime() }));
    },
    async findByOriginal(sha256) {
      const [row] = await getDb()
        .select({ photoId: activityPhotos.id, activityId: activityPhotos.activityId })
        .from(activityPhotos)
        .where(eq(activityPhotos.originalSha256, sha256))
        .limit(1);
      return row ?? null;
    },
    async putOriginal(bytes, format, image) {
      if (!isRawStoreConfigured()) return null;
      const { sha256 } = await getRawStore().put(bytes, {
        kind: "photo-original",
        contentType: FORMAT_CONTENT_TYPES[format],
        filename: image.fileName,
        metadata: { via: "telegram-photo", sentAs: image.kind, fileUniqueId: image.fileUniqueId },
      });
      return sha256;
    },
    readExif: (bytes) => readPhotoExif(bytes),
    toPublic: makePublicJpeg,
    async putPublic(pathname, bytes) {
      return (await r2Put(pathname, bytes, "image/jpeg")).url;
    },
    async insertPhoto(row) {
      const db = getDb();
      const [{ top }] = await db
        .select({ top: max(activityPhotos.position) })
        .from(activityPhotos)
        .where(eq(activityPhotos.activityId, row.activityId));
      const [inserted] = await db
        .insert(activityPhotos)
        .values({ ...row, position: (top ?? -1) + 1, caption: null })
        .returning({ id: activityPhotos.id });
      return inserted.id;
    },
    async loadPhoto(photoId) {
      const [row] = await getDb()
        .select({ activityId: activityPhotos.activityId, blobPathname: activityPhotos.blobPathname })
        .from(activityPhotos)
        .where(eq(activityPhotos.id, photoId))
        .limit(1);
      return row ?? null;
    },
    async deletePhoto(photoId) {
      await getDb().delete(activityPhotos).where(eq(activityPhotos.id, photoId));
    },
    deletePublic: (pathname) => r2Delete(pathname),
    async refresh(activityId) {
      try {
        await republish(activityId);
      } catch (error) {
        log.error("telegram:photo", `republish after photo change failed for ${activityId}`, error);
      }
      await invalidateCache("activities_list", "activities_latest");
      revalidatePath(`/activities/${activityId}`);
    },
    timezone: liftTimezone,
    newPathname: () => `activities/photos/${new Date().getUTCFullYear()}/${randomUUID()}.jpg`,
  };
}
