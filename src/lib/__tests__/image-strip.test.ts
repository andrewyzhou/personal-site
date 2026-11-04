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
  seg,
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

  it("allowlist: drops JPGn extensions (0xf0–0xfd), TEM, jfxx and unknown APPn; keeps sof2, dri, dac, dnl", () => {
    const p = JPEG_PARTS;
    const sof2 = seg(0xc2, [8, 0, 8, 0, 8, 1, 1, 0x11, 0]);
    const dri = seg(0xdd, [0, 4]);
    const dac = seg(0xcc, [0x00, 0x10]);
    const dnl = seg(0xdc, [0, 8]);
    const jfxx = seg(0xe0, concatBytes(new TextEncoder().encode("JFXX\0"), [0x10, 1, 2, 3]));
    const junk = [0xf0, 0xf7, 0xfd].map((m) => seg(m, new TextEncoder().encode("GPSLatitude 37.87")));
    const src = concatBytes(p.soi, p.app0, jfxx, [0xff, 0x01], ...junk, p.dqt, sof2, dri, dac, p.dht, p.sos, p.scan, dnl, p.eoi);
    const out = stripJpeg(src);
    expect(Array.from(out)).toEqual(Array.from(concatBytes(p.soi, p.app0, p.dqt, sof2, dri, dac, p.dht, p.sos, p.scan, dnl, p.eoi)));
    expect(text(out)).not.toContain("GPS");
  });

  it("cuts an embedded jfif thumbnail and zeroes its size", () => {
    const p = JPEG_PARTS;
    const withThumb = seg(0xe0, [...new TextEncoder().encode("JFIF"), 0, 1, 1, 0, 0, 1, 0, 1, 2, 1, 9, 9, 9, 8, 8, 8]);
    const out = stripJpeg(concatBytes(p.soi, withThumb, p.dqt, p.sof, p.sos, p.scan, p.eoi));
    expect(Array.from(out)).toEqual(Array.from(concatBytes(p.soi, p.app0, p.dqt, p.sof, p.sos, p.scan, p.eoi)));
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

  it("allowlist: drops unknown chunks, keeps alpha and animation chunks", () => {
    const p = WEBP_PARTS;
    const alph = riffChunk("ALPH", [0, 1, 2]);
    const anim = riffChunk("ANIM", [0, 0, 0, 0, 0, 0]);
    const anmf = riffChunk("ANMF", new Array(16).fill(1));
    const unknown = riffChunk("XYZW", new TextEncoder().encode("GPSLatitude 37.87"));
    const lower = riffChunk("meta", [1, 2, 3, 4]);
    const out = stripWebp(webpFile([p.vp8x(0x10 | 0x02), p.iccp, unknown, anim, anmf, lower, alph, p.vp8l]));
    expect(Array.from(out)).toEqual(Array.from(webpFile([p.vp8x(0x10 | 0x02), p.iccp, anim, anmf, alph, p.vp8l])));
    expect(text(out)).not.toContain("GPS");
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

  it("allowlist: drops tIME and private/unknown chunks", () => {
    const p = PNG_PARTS;
    const time = pngChunk("tIME", [0x07, 0xea, 10, 3, 8, 2, 52]);
    const priv = pngChunk("prVt", new TextEncoder().encode("GPSLatitude 37.87"));
    const unknownCritical = pngChunk("ZZZZ", [1, 2, 3]);
    const caBX = pngChunk("caBX", [1, 2, 3]);
    const out = stripPng(concatBytes(p.sig, p.ihdr, time, priv, caBX, unknownCritical, p.idat, p.iend));
    expect(Array.from(out)).toEqual(Array.from(concatBytes(p.sig, p.ihdr, p.idat, p.iend)));
    expect(hasLocationMetadata(concatBytes(p.sig, p.ihdr, priv, p.idat, p.iend))).toBe(true);
  });

  it("keeps color, display and apng chunks in order", () => {
    const p = PNG_PARTS;
    const keep = [
      pngChunk("cHRM", new Array(32).fill(0)), pngChunk("gAMA", [0, 0, 0xb1, 0x8f]), pngChunk("sBIT", [8, 8, 8]),
      pngChunk("sRGB", [0]), pngChunk("PLTE", [0, 0, 0]), pngChunk("tRNS", [0]), pngChunk("bKGD", [0]),
      pngChunk("pHYs", [0, 0, 0x0b, 0x13, 0, 0, 0x0b, 0x13, 1]), pngChunk("acTL", [0, 0, 0, 1, 0, 0, 0, 0]),
      pngChunk("fcTL", new Array(26).fill(0)),
    ];
    const fdat = pngChunk("fdAT", [0, 0, 0, 1, 0x78, 0x9c]);
    const src = concatBytes(p.sig, p.ihdr, ...keep, p.idat, fdat, p.iend);
    expect(Array.from(stripPng(src))).toEqual(Array.from(src));
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
