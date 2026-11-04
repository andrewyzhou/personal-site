// exif → private photo fields (precise gps + capture time). pure and shared:
// the finalize route reads it from the stored original, the admin client from
// the file when no original is kept. results only ever reach admin endpoints.

export interface PhotoExifMeta {
  takenAt: string | null; // absolute iso instant
  takenAtLocal: string | null; // wall clock without a known offset ("2026-10-03T08:02:52")
  gps: { lat: number; lng: number } | null;
}

const EXIF_PICK = [
  "DateTimeOriginal", "CreateDate", "OffsetTimeOriginal", "OffsetTime",
  "GPSDateStamp", "GPSTimeStamp", "GPSLatitude", "GPSLatitudeRef", "GPSLongitude", "GPSLongitudeRef",
  "latitude", "longitude",
];

const EXIF_DATE_RE = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/;
const OFFSET_RE = /^([+-])(\d{2}):?(\d{2})$/;

function validCoord(lat: unknown, lng: unknown): { lat: number; lng: number } | null {
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  if (lat === 0 && lng === 0) return null; // unset gps on many cameras
  return { lat, lng };
}

function gpsInstant(dateStamp: unknown, timeStamp: unknown): string | null {
  const d = typeof dateStamp === "string" ? dateStamp.match(/^(\d{4}):(\d{2}):(\d{2})/) : null;
  if (!d) return null;
  let h: number, m: number, s: number;
  if (Array.isArray(timeStamp) && timeStamp.length === 3) [h, m, s] = timeStamp.map(Number);
  else if (typeof timeStamp === "string" && /^\d{1,2}:\d{2}:\d{2}/.test(timeStamp)) [h, m, s] = timeStamp.split(":").map(Number);
  else return null;
  if (![h, m, s].every(Number.isFinite)) return null;
  const ms = Date.UTC(+d[1], +d[2] - 1, +d[3], h, m, Math.floor(s), Math.round((s % 1) * 1000));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

// raw exifr output (reviveValues: false) → time + precise gps
export function exifToMeta(data: Record<string, unknown> | null | undefined): PhotoExifMeta {
  const out: PhotoExifMeta = { takenAt: null, takenAtLocal: null, gps: null };
  if (!data) return out;
  out.gps = validCoord(data.latitude, data.longitude);

  // cameras write "0000:00:00 00:00:00" for an unset clock
  const plausible = (v: string) => {
    const m = v.match(EXIF_DATE_RE)!;
    return +m[1] >= 1990 && +m[2] >= 1 && +m[2] <= 12 && +m[3] >= 1 && +m[3] <= 31 && +m[4] <= 23 && +m[5] <= 59 && +m[6] <= 60;
  };
  const dto = [data.DateTimeOriginal, data.CreateDate].find(
    (v): v is string => typeof v === "string" && EXIF_DATE_RE.test(v) && plausible(v)
  );
  const offset = [data.OffsetTimeOriginal, data.OffsetTime].find((v): v is string => typeof v === "string" && OFFSET_RE.test(v.trim()));
  if (dto) {
    const [, y, mo, d, h, mi, s] = dto.match(EXIF_DATE_RE)!;
    const local = `${y}-${mo}-${d}T${h}:${mi}:${s}`;
    if (offset) {
      const [, sign, oh, om] = offset.trim().match(OFFSET_RE)!;
      const offMin = (sign === "-" ? -1 : 1) * (Number(oh) * 60 + Number(om));
      const ms = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s) - offMin * 60_000;
      if (Number.isFinite(ms)) out.takenAt = new Date(ms).toISOString();
    }
    if (!out.takenAt) out.takenAtLocal = local;
  }
  // gps time is utc: the best answer when the camera wrote no offset
  if (!out.takenAt) {
    const g = gpsInstant(data.GPSDateStamp, data.GPSTimeStamp);
    if (g) {
      out.takenAt = g;
      out.takenAtLocal = null;
    }
  }
  return out;
}

export async function readPhotoExif(input: Uint8Array | Blob): Promise<PhotoExifMeta> {
  try {
    const exifr = (await import("exifr")).default;
    const data = await exifr.parse(input, {
      tiff: true, exif: true, gps: true,
      xmp: false, icc: false, iptc: false, jfif: false, ihdr: false,
      reviveValues: false,
      pick: EXIF_PICK,
    });
    return exifToMeta(data);
  } catch {
    return { takenAt: null, takenAtLocal: null, gps: null };
  }
}

// a wall-clock time from exif + the activity's utc offset → an instant
export function resolveTakenAt(meta: Pick<PhotoExifMeta, "takenAt" | "takenAtLocal">, utcOffsetMin?: number | null): string | null {
  if (meta.takenAt) return meta.takenAt;
  if (!meta.takenAtLocal || typeof utcOffsetMin !== "number" || !Number.isFinite(utcOffsetMin)) return null;
  const ms = Date.parse(`${meta.takenAtLocal}Z`) - utcOffsetMin * 60_000;
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}
