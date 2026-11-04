import { isSha256 } from "@/lib/raw-store";

// the photo list publish/PATCH accept. private fields (original link, capture
// time, precise gps) are optional; absent or null means "not provided".

export interface PhotoInput {
  pathname: string;
  url: string;
  width: number | null;
  height: number | null;
  caption: string | null;
  originalSha256?: string;
  takenAt?: Date;
  gps?: { lat: number; lng: number };
}

const MAX_PHOTOS = 50;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})$/;

const given = (v: unknown) => v !== undefined && v !== null;
const dim = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : null);

export function parsePhotoList(raw: unknown): { photos: PhotoInput[] } | { error: string } {
  if (!Array.isArray(raw)) return { error: "photos must be an array" };
  if (raw.length > MAX_PHOTOS) return { error: `at most ${MAX_PHOTOS} photos` };
  const photos: PhotoInput[] = [];
  for (const [i, p] of raw.entries()) {
    const at = `photos[${i}]`;
    if (!p || typeof p !== "object") return { error: `${at} must be an object` };
    const o = p as Record<string, unknown>;
    if (typeof o.pathname !== "string" || !o.pathname || typeof o.url !== "string" || !o.url) {
      return { error: `${at} needs pathname and url` };
    }
    const photo: PhotoInput = {
      pathname: o.pathname,
      url: o.url,
      width: dim(o.width),
      height: dim(o.height),
      caption: typeof o.caption === "string" ? o.caption : null,
    };
    if (given(o.originalSha256)) {
      if (typeof o.originalSha256 !== "string" || !isSha256(o.originalSha256)) return { error: `${at}.originalSha256 is not a sha256` };
      photo.originalSha256 = o.originalSha256;
    }
    if (given(o.takenAt)) {
      const ms = typeof o.takenAt === "string" && ISO_RE.test(o.takenAt) ? Date.parse(o.takenAt) : NaN;
      if (!Number.isFinite(ms)) return { error: `${at}.takenAt is not an iso date` };
      photo.takenAt = new Date(ms);
    }
    if (given(o.gpsLat) || given(o.gpsLng)) {
      const lat = o.gpsLat;
      const lng = o.gpsLng;
      if (
        typeof lat !== "number" || typeof lng !== "number" ||
        !Number.isFinite(lat) || !Number.isFinite(lng) ||
        Math.abs(lat) > 90 || Math.abs(lng) > 180
      ) {
        return { error: `${at}.gpsLat/gpsLng must be a valid coordinate pair` };
      }
      photo.gps = { lat, lng };
    }
    photos.push(photo);
  }
  return { photos };
}

// untouched photo originals (heic/jpeg straight off the phone) in the raw bucket
export const MAX_ORIGINAL_BYTES = 50_000_000;
