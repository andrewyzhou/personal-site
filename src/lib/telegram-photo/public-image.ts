// the public copy of a photo: what the admin client makes in the browser,
// made on the server with sharp. upright, at most 2000px, jpeg, no metadata.

import { sniffImageFormat, stripImageMetadata } from "@/lib/image-strip";
import { UnsupportedImageError, type PublicImage } from "./attach";

const MAX_EDGE_PX = 2000;
const JPEG_QUALITY = 85;

/** an isobmff image whose major brand is avif (which the bundled decoder handles) */
function isAvif(bytes: Uint8Array): boolean {
  const brand = String.fromCharCode(...bytes.subarray(8, 12));
  return brand === "avif" || brand === "avis";
}

/** ≤2000px jpeg, upright, no metadata: what the admin client uploads */
export async function makePublicJpeg(bytes: Uint8Array): Promise<PublicImage> {
  // the prebuilt image library has no hevc decoder, and handing it an iphone
  // heic can take the whole process down, so only avif goes past this point
  if (sniffImageFormat(bytes) === "heic" && !isAvif(bytes)) throw new UnsupportedImageError("heic (hevc) can't be decoded here");
  let out: { data: Buffer; info: { width: number; height: number } };
  try {
    const sharp = (await import("sharp")).default;
    out = await sharp(bytes, { failOn: "error" })
      .rotate()
      .resize({ width: MAX_EDGE_PX, height: MAX_EDGE_PX, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: JPEG_QUALITY })
      .toBuffer({ resolveWithObject: true });
  } catch (error) {
    // anything else it can't read
    throw new UnsupportedImageError(error instanceof Error ? error.message : String(error));
  }
  // sharp drops metadata unless asked to keep it; strip anyway so nothing public ever carries exif
  return { bytes: stripImageMetadata(new Uint8Array(out.data)), width: out.info.width, height: out.info.height };
}
