import { describe, it, expect } from "vitest";
import { exifToMeta, readPhotoExif, resolveTakenAt } from "@/app/api/admin/photos/exif";
import { buildJpeg, buildTiff } from "@/lib/__tests__/fixtures/images";

describe("photo exif", () => {
  it("reads precise gps and DateTimeOriginal with its offset from a jpeg", async () => {
    const jpeg = buildJpeg(buildTiff({ lat: 37.8716, lng: -122.2727, dateTimeOriginal: "2026:10:03 08:02:52", offsetTimeOriginal: "-07:00" }));
    const meta = await readPhotoExif(jpeg);
    expect(meta.takenAt).toBe("2026-10-03T15:02:52.000Z");
    expect(meta.takenAtLocal).toBeNull();
    expect(meta.gps!.lat).toBeCloseTo(37.8716, 4);
    expect(meta.gps!.lng).toBeCloseTo(-122.2727, 4);
  });

  it("keeps a wall-clock time when there is no offset, resolved by the activity's offset", async () => {
    const meta = await readPhotoExif(buildJpeg(buildTiff({ dateTimeOriginal: "2026:10:03 08:02:52" })));
    expect(meta).toEqual({ takenAt: null, takenAtLocal: "2026-10-03T08:02:52", gps: null });
    expect(resolveTakenAt(meta, -420)).toBe("2026-10-03T15:02:52.000Z");
    expect(resolveTakenAt(meta, null)).toBeNull();
  });

  it("falls back to gps time (utc) when no offset is written", () => {
    const meta = exifToMeta({ DateTimeOriginal: "2026:10:03 08:02:52", GPSDateStamp: "2026:10:03", GPSTimeStamp: [15, 2, 51] });
    expect(meta.takenAt).toBe("2026-10-03T15:02:51.000Z");
    expect(meta.takenAtLocal).toBeNull();
  });

  it("drops unset or impossible coordinates and garbage dates", () => {
    expect(exifToMeta({ latitude: 0, longitude: 0 }).gps).toBeNull();
    expect(exifToMeta({ latitude: 91, longitude: 0.5 }).gps).toBeNull();
    expect(exifToMeta({ DateTimeOriginal: "0000:00:00 00:00:00", OffsetTimeOriginal: "+00:00" })).toEqual({
      takenAt: null,
      takenAtLocal: null,
      gps: null,
    });
    expect(exifToMeta({ DateTimeOriginal: "not a date" })).toEqual({ takenAt: null, takenAtLocal: null, gps: null });
    expect(exifToMeta(null)).toEqual({ takenAt: null, takenAtLocal: null, gps: null });
  });

  it("returns nothing (never throws) for non-images", async () => {
    expect(await readPhotoExif(new Uint8Array([1, 2, 3]))).toEqual({ takenAt: null, takenAtLocal: null, gps: null });
  });
});
