"use client";

// client-side photo preparation: heic decode (lazy wasm import) + canvas
// downscale to ≤2000px jpeg. mandatory before upload — exif (incl. gps) is
// stripped by the re-encode, browsers can't show heic, and small files keep
// uploads fast and storage lean.

const MAX_EDGE_PX = 2000;
const JPEG_QUALITY = 0.85;

export interface PreparedImage {
  blob: Blob;
  width: number;
  height: number;
}

function isHeic(file: File): boolean {
  return /heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name);
}

async function toBitmap(source: Blob): Promise<ImageBitmap | HTMLImageElement> {
  try {
    return await createImageBitmap(source, { imageOrientation: "from-image" });
  } catch {
    // older safari fallback
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new window.Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("could not decode image"));
      img.src = URL.createObjectURL(source);
    });
  }
}

export async function prepareImage(file: File): Promise<PreparedImage> {
  let source: Blob = file;
  if (isHeic(file)) {
    const heic2any = (await import("heic2any")).default;
    const converted = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.9 });
    source = Array.isArray(converted) ? converted[0] : converted;
  }

  const bmp = await toBitmap(source);
  const srcW = "width" in bmp ? bmp.width : 0;
  const srcH = "height" in bmp ? bmp.height : 0;
  if (!srcW || !srcH) throw new Error("could not read image dimensions");

  const scale = Math.min(1, MAX_EDGE_PX / Math.max(srcW, srcH));
  const w = Math.round(srcW * scale);
  const h = Math.round(srcH * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unavailable");
  ctx.drawImage(bmp, 0, 0, w, h);

  const blob = await new Promise<Blob>((resolve, reject) => {
    // jpeg, not webp: safari cannot encode webp via canvas
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("image encode failed"))), "image/jpeg", JPEG_QUALITY);
  });

  return { blob, width: w, height: h };
}
