import { describe, it, expect } from "vitest";
import exifr from "exifr";
import {
  hasLocationMetadata,
  ImageStripError,
  sniffImageFormat,
  stripImageMetadata,
  stripJpeg,
  stripPng,
  stripWebp,
} from "../image-strip";
import {
  buildJpeg,
  buildPng,
  buildTiff,
  buildWebp,
  concatBytes,
  exifApp1,
  JPEG_PARTS,
  PNG_PARTS,
  pngChunk,
  riffChunk,
  strippedJpeg,
  WEBP_PARTS,
  webpFile,
} from "./fixtures/images";

const TIFF = buildTiff({ lat: 37.8716, lng: -122.2727, dateTimeOriginal: "2026:10:03 08:02:52", offsetTimeOriginal: "-07:00" });
const text = (b: Uint8Array) => Buffer.from(b).toString("latin1");

describe("fixtures", () => {
  it("carry real gps exif (exifr reads it)", async () => {
    for (const img of [buildJpeg(TIFF), buildPng(TIFF)]) {
      const gps = await exifr.gps(img);
      expect(gps.latitude).toBeCloseTo(37.8716, 4);
      expect(gps.longitude).toBeCloseTo(-122.2727, 4);
    }
  });
});

describe("sniffImageFormat", () => {
  it("detects by magic bytes, not by name", () => {
    expect(sniffImageFormat(buildJpeg(TIFF))).toBe("jpeg");
    expect(sniffImageFormat(buildPng(TIFF))).toBe("png");
    expect(sniffImageFormat(buildWebp(TIFF))).toBe("webp");
    expect(sniffImageFormat(concatBytes([0, 0, 0, 24], new TextEncoder().encode("ftypheic"), [0, 0, 0, 0]))).toBe("heic");
    expect(sniffImageFormat(new TextEncoder().encode("GIF89a......"))).toBeNull();
  });
});

describe("jpeg", () => {
  it("drops exif/xmp/iptc/com/mpf/APPn and trailing data, keeps jfif, icc, adobe and the scan byte-for-byte", async () => {
    const src = buildJpeg(TIFF);
    const out = stripJpeg(src);
    expect(Array.from(out)).toEqual(Array.from(strippedJpeg()));
    expect(hasLocationMetadata(src)).toBe(true);
    expect(hasLocationMetadata(out)).toBe(false);
    expect(await exifr.gps(out).catch(() => undefined)).toBeUndefined();
    const s = text(out);
    expect(s).not.toContain("Exif");
    expect(s).not.toContain("GPSLatitude");
    expect(s).not.toContain("Photoshop");
    expect(s).not.toContain("shot on a phone");
    expect(s).toContain("ICC_PROFILE");
  });

  it("is idempotent", () => {
    const once = stripJpeg(buildJpeg(TIFF));
    expect(Array.from(stripJpeg(once))).toEqual(Array.from(once));
  });

  it("handles fill bytes before markers and multiple scans (progressive)", () => {
    const p = JPEG_PARTS;
    const src = concatBytes(
      p.soi, [0xff], exifApp1(TIFF), p.dqt, p.sof, p.dht, p.sos, p.scan, p.dht, p.sos, [0x01, 0xff, 0x00, 0x02], p.eoi
    );
    const out = stripJpeg(src);
    expect(Array.from(out)).toEqual(
      Array.from(concatBytes(p.soi, p.dqt, p.sof, p.dht, p.sos, p.scan, p.dht, p.sos, [0x01, 0xff, 0x00, 0x02], p.eoi))
    );
  });

  it("refuses truncated or scanless files", () => {
    const p = JPEG_PARTS;
    expect(() => stripJpeg(concatBytes(p.soi, p.app0, p.dqt))).toThrow(ImageStripError);
    expect(() => stripJpeg(concatBytes(p.soi, p.app0, p.sos, p.scan))).toThrow(ImageStripError);
    expect(() => stripJpeg(concatBytes(p.soi, p.app0, p.eoi))).toThrow(ImageStripError);
    expect(() => stripJpeg(concatBytes(p.soi, [0xff, 0xe1, 0xff, 0xff, 1, 2]))).toThrow(ImageStripError);
  });
});

describe("webp", () => {
  it("drops EXIF and XMP, clears their vp8x flags, keeps icc and image data, fixes the riff size", () => {
    const src = buildWebp(TIFF);
    const out = stripWebp(src);
    const p = WEBP_PARTS;
    expect(Array.from(out)).toEqual(Array.from(webpFile([p.vp8x(0x20), p.iccp, p.vp8l])));
    const riffSize = out[4] | (out[5] << 8) | (out[6] << 16) | (out[7] << 24);
    expect(riffSize).toBe(out.length - 8);
    expect(hasLocationMetadata(src)).toBe(true);
    expect(hasLocationMetadata(out)).toBe(false);
  });

  it("strips a simple (non-vp8x) webp's stray exif too", () => {
    const vp8 = riffChunk("VP8 ", [1, 2, 3, 4]);
    const out = stripWebp(webpFile([vp8, riffChunk("EXIF", TIFF)]));
    expect(Array.from(out)).toEqual(Array.from(webpFile([vp8])));
  });

  it("refuses a webp without image data", () => {
    expect(() => stripWebp(webpFile([WEBP_PARTS.vp8x(0), riffChunk("EXIF", TIFF)]))).toThrow(ImageStripError);
  });
});

describe("png", () => {
  it("drops eXIf, tEXt, iTXt, zTXt and keeps the image chunks", () => {
    const src = buildPng(TIFF);
    const out = stripPng(src);
    const p = PNG_PARTS;
    expect(Array.from(out)).toEqual(Array.from(concatBytes(p.sig, p.ihdr, p.idat, p.iend)));
    expect(hasLocationMetadata(src)).toBe(true);
    expect(hasLocationMetadata(out)).toBe(false);
  });

  it("keeps an iCCP profile", () => {
    const iccp = pngChunk("iCCP", [0x69, 0x63, 0x63, 0, 0, 0x78, 0x9c]);
    const p = PNG_PARTS;
    const out = stripPng(concatBytes(p.sig, p.ihdr, iccp, pngChunk("eXIf", TIFF), p.idat, p.iend));
    expect(Array.from(out)).toEqual(Array.from(concatBytes(p.sig, p.ihdr, iccp, p.idat, p.iend)));
  });
});

describe("stripImageMetadata", () => {
  it("dispatches on content and refuses unknown formats", () => {
    expect(Array.from(stripImageMetadata(buildJpeg(TIFF)))).toEqual(Array.from(strippedJpeg()));
    expect(() => stripImageMetadata(new TextEncoder().encode("GIF89a......"))).toThrow(ImageStripError);
  });
});

describe("hasLocationMetadata", () => {
  it("is false for exif without a gps ifd", () => {
    const tiff = buildTiff({ dateTimeOriginal: "2026:10:03 08:02:52" });
    const p = JPEG_PARTS;
    expect(hasLocationMetadata(concatBytes(p.soi, exifApp1(tiff), p.dqt, p.sof, p.sos, p.scan, p.eoi))).toBe(false);
  });

  it("finds xmp gps text in a jpeg with no exif", () => {
    const p = JPEG_PARTS;
    expect(hasLocationMetadata(concatBytes(p.soi, p.xmp, p.dqt, p.sof, p.sos, p.scan, p.eoi))).toBe(true);
  });

  it("scans unknown containers (heic) for a tiff gps ifd", () => {
    const heic = concatBytes([0, 0, 0, 24], new TextEncoder().encode("ftypheic"), [0, 0, 0, 0], [0, 0, 0, 6], TIFF);
    expect(hasLocationMetadata(heic)).toBe(true);
    const clean = concatBytes([0, 0, 0, 24], new TextEncoder().encode("ftypheic"), [0, 0, 0, 0], buildTiff({}));
    expect(hasLocationMetadata(clean)).toBe(false);
  });
});
