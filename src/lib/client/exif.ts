"use client";

// exif extraction for photo essays, run BEFORE the canvas downscale strips
// metadata. gps is rounded to ~1km here, client-side, because the yaml lands in
// a public repo — exact coordinates must never leave the device.

import type { PhotoExif } from "@/lib/photos";

export interface ExtractedMeta {
  exif?: PhotoExif;
  gps?: { lat: number; lon: number };
  takenAt?: string;
}

export function formatShutter(exposureTime: number): string {
  if (exposureTime >= 1) return `${exposureTime}s`;
  return `1/${Math.round(1 / exposureTime)}s`;
}

export function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export async function extractMeta(file: File): Promise<ExtractedMeta> {
  try {
    const exifr = (await import("exifr")).default;
    const data = await exifr.parse(file, {
      pick: [
        "Make", "Model", "LensModel", "FNumber", "ExposureTime", "ISO",
        "FocalLength", "DateTimeOriginal", "latitude", "longitude",
      ],
    });
    if (!data) return {};

    const exif: PhotoExif = {};
    if (data.Make || data.Model) {
      exif.camera = [data.Make, data.Model].filter(Boolean).join(" ").trim();
    }
    if (data.LensModel) exif.lens = String(data.LensModel);
    if (typeof data.FNumber === "number") exif.aperture = `f/${data.FNumber}`;
    if (typeof data.ExposureTime === "number") exif.shutter = formatShutter(data.ExposureTime);
    if (typeof data.ISO === "number") exif.iso = data.ISO;
    if (typeof data.FocalLength === "number") exif.focalLength = `${Math.round(data.FocalLength)}mm`;

    const out: ExtractedMeta = {};
    if (Object.keys(exif).length > 0) out.exif = exif;
    if (typeof data.latitude === "number" && typeof data.longitude === "number") {
      out.gps = { lat: round2(data.latitude), lon: round2(data.longitude) };
    }
    if (data.DateTimeOriginal instanceof Date) {
      out.takenAt = data.DateTimeOriginal.toISOString();
    }
    return out;
  } catch {
    return {};
  }
}
