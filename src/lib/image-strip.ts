// metadata stripping for every image that becomes public. pure, byte-level, no
// re-encode: pixels and color profiles are kept exactly, everything that can
// carry location, time, device or editing history is dropped. allowlists, not
// denylists: anything not known to be pixel or color data goes.
//   jpeg: keep SOI/EOI, SOFn, DHT, DQT, DRI, DAC, DNL, DHP, EXP, SOS + scan,
//         RSTn, APP0 jfif (thumbnail cut), APP2 icc, APP14 adobe. drop the rest
//         (exif/xmp, iptc, mpf, COM, JPGn extensions…) and anything after EOI
//   webp: keep VP8, VP8L, VP8X, ALPH, ANIM, ANMF, ICCP; clear the vp8x
//         exif/xmp flags, fix the riff size
//   png:  keep the image, color and apng chunks only (no text, time, exif or
//         private chunks)
// malformed input throws ImageStripError: callers reject rather than publish
// bytes they couldn't fully parse.

export type ImageFormat = "jpeg" | "png" | "webp" | "heic";

export class ImageStripError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageStripError";
  }
}

const ascii = (bytes: Uint8Array, start: number, len: number) =>
  String.fromCharCode(...bytes.subarray(start, start + len));

export function sniffImageFormat(bytes: Uint8Array): ImageFormat | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.length >= 8 && ascii(bytes, 0, 8) === "\x89PNG\r\n\x1a\n") return "png";
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return "webp";
  if (bytes.length >= 12 && ascii(bytes, 4, 4) === "ftyp") {
    const brand = ascii(bytes, 8, 4);
    if (["heic", "heix", "heim", "heis", "hevc", "hevx", "mif1", "msf1", "avif"].includes(brand)) return "heic";
  }
  return null;
}

export const FORMAT_CONTENT_TYPES: Record<ImageFormat, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
};

export function stripImageMetadata(bytes: Uint8Array): Uint8Array {
  const format = sniffImageFormat(bytes);
  if (format === "jpeg") return stripJpeg(bytes);
  if (format === "png") return stripPng(bytes);
  if (format === "webp") return stripWebp(bytes);
  throw new ImageStripError(`unsupported image format${format ? ` (${format})` : ""}`);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

// ---------------------------------------------------------------------------
// jpeg

interface JpegSegment {
  marker: number;
  start: number; // offset of the 0xff of the marker
  end: number; // exclusive, includes the entropy-coded data after an SOS
  payload: Uint8Array; // segment data after the length field (empty for standalone markers)
}

// standalone markers carry no length field: TEM, RST0–7, SOI, EOI
const standalone = (m: number) => m === 0x01 || (m >= 0xd0 && m <= 0xd9);

function* jpegSegments(bytes: Uint8Array): Generator<JpegSegment> {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new ImageStripError("not a jpeg");
  let i = 2;
  yield { marker: 0xd8, start: 0, end: 2, payload: new Uint8Array(0) };
  while (i < bytes.length) {
    if (bytes[i] !== 0xff) throw new ImageStripError(`expected a marker at ${i}`);
    // fill bytes: any number of 0xff before the marker code
    let j = i + 1;
    while (j < bytes.length && bytes[j] === 0xff) j++;
    if (j >= bytes.length) throw new ImageStripError("truncated marker");
    const marker = bytes[j];
    const start = i;
    i = j + 1;
    if (marker === 0x00) throw new ImageStripError(`stray stuffed byte at ${start}`);
    if (standalone(marker)) {
      yield { marker, start, end: i, payload: new Uint8Array(0) };
      if (marker === 0xd9) return; // EOI: trailing bytes are dropped
      continue;
    }
    if (i + 2 > bytes.length) throw new ImageStripError("truncated segment length");
    const len = (bytes[i] << 8) | bytes[i + 1];
    if (len < 2 || i + len > bytes.length) throw new ImageStripError(`bad segment length at ${start}`);
    const payload = bytes.subarray(i + 2, i + len);
    i += len;
    if (marker === 0xda) {
      // SOS: entropy-coded data runs to the next marker that isn't a stuffed
      // 0xff00, an RSTn or fill
      while (i < bytes.length) {
        if (bytes[i] === 0xff) {
          let k = i + 1;
          while (k < bytes.length && bytes[k] === 0xff) k++;
          if (k >= bytes.length) throw new ImageStripError("truncated scan");
          const next = bytes[k];
          if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
            i = k + 1;
            continue;
          }
          break;
        }
        i++;
      }
      if (i >= bytes.length) throw new ImageStripError("scan ran past the end of the file");
    }
    yield { marker, start, end: i, payload };
  }
  throw new ImageStripError("missing EOI");
}

// SOF0–3, 5–7, 9–11, 13–15 (0xc4 is DHT, 0xc8 is JPG, 0xcc is DAC)
const isSof = (m: number) => m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;
const isRst = (m: number) => m >= 0xd0 && m <= 0xd7;
const JPEG_KEEP = new Set([
  0xd8, 0xd9, // SOI, EOI
  0xc4, 0xdb, 0xdd, 0xcc, 0xdc, 0xde, 0xdf, // DHT, DQT, DRI, DAC, DNL, DHP, EXP
  0xda, // SOS (+ its scan data)
]);
const JFIF_LEN = 14; // "JFIF\0", version, units, density x/y, thumbnail w/h

// the bytes to publish for a segment, or null to drop it
function keepJpegSegment(bytes: Uint8Array, seg: JpegSegment): Uint8Array | null {
  const m = seg.marker;
  const raw = bytes.subarray(seg.start, seg.end);
  if (isSof(m) || isRst(m) || JPEG_KEEP.has(m)) return raw;
  if (m === 0xe0) {
    // jfif only (jfxx is a thumbnail). an embedded thumbnail could show the
    // uncropped photo, so it's cut and its size zeroed
    const p = seg.payload;
    if (ascii(p, 0, 5) !== "JFIF\0" || p.length < JFIF_LEN) return null;
    if (p.length === JFIF_LEN && p[12] === 0 && p[13] === 0) return raw;
    const out = new Uint8Array(4 + JFIF_LEN);
    out.set([0xff, 0xe0, 0, JFIF_LEN + 2]);
    out.set(p.subarray(0, 12), 4);
    return out;
  }
  if (m === 0xe2) return ascii(seg.payload, 0, 12) === "ICC_PROFILE\0" ? raw : null; // icc only, never mpf/flashpix
  if (m === 0xee) return ascii(seg.payload, 0, 5) === "Adobe" ? raw : null; // color transform flag
  return null;
}

export function stripJpeg(bytes: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [];
  let sawEoi = false;
  let sawSos = false;
  for (const seg of jpegSegments(bytes)) {
    if (seg.marker === 0xd9) sawEoi = true;
    if (seg.marker === 0xda) sawSos = true;
    const kept = keepJpegSegment(bytes, seg);
    if (kept) parts.push(kept);
  }
  if (!sawSos || !sawEoi) throw new ImageStripError("jpeg has no image data");
  return concat(parts);
}

// ---------------------------------------------------------------------------
// png

const PNG_KEEP = new Set([
  "IHDR", "PLTE", "IDAT", "IEND", // critical
  "tRNS", "gAMA", "cHRM", "sRGB", "iCCP", "sBIT", "pHYs", "bKGD", // color / display
  "acTL", "fcTL", "fdAT", // apng
]);

interface PngChunk {
  type: string;
  start: number;
  end: number;
  data: Uint8Array;
}

function* pngChunks(bytes: Uint8Array): Generator<PngChunk> {
  let i = 8;
  while (i < bytes.length) {
    if (i + 12 > bytes.length) throw new ImageStripError("truncated png chunk");
    const len = ((bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3]) >>> 0;
    const type = ascii(bytes, i + 4, 4);
    const end = i + 12 + len;
    if (end > bytes.length) throw new ImageStripError(`png chunk ${type} runs past the end`);
    yield { type, start: i, end, data: bytes.subarray(i + 8, i + 8 + len) };
    i = end;
    if (type === "IEND") return;
  }
  throw new ImageStripError("missing IEND");
}

export function stripPng(bytes: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [bytes.subarray(0, 8)];
  let sawData = false;
  for (const c of pngChunks(bytes)) {
    if (c.type === "IDAT") sawData = true;
    if (PNG_KEEP.has(c.type)) parts.push(bytes.subarray(c.start, c.end));
  }
  if (!sawData) throw new ImageStripError("png has no image data");
  return concat(parts);
}

// ---------------------------------------------------------------------------
// webp

const WEBP_KEEP = new Set(["VP8 ", "VP8L", "VP8X", "ALPH", "ANIM", "ANMF", "ICCP"]);
const VP8X_EXIF = 0x08;
const VP8X_XMP = 0x04;

interface RiffChunk {
  fourcc: string;
  start: number;
  end: number; // includes the pad byte
  data: Uint8Array;
}

function* webpChunks(bytes: Uint8Array): Generator<RiffChunk> {
  const riffSize = (bytes[4] | (bytes[5] << 8) | (bytes[6] << 16) | (bytes[7] << 24)) >>> 0;
  const total = Math.min(bytes.length, 8 + riffSize);
  let i = 12;
  while (i < total) {
    if (i + 8 > total) throw new ImageStripError("truncated webp chunk");
    const fourcc = ascii(bytes, i, 4);
    const len = (bytes[i + 4] | (bytes[i + 5] << 8) | (bytes[i + 6] << 16) | (bytes[i + 7] << 24)) >>> 0;
    const dataEnd = i + 8 + len;
    if (dataEnd > total) throw new ImageStripError(`webp chunk ${fourcc} runs past the end`);
    const end = Math.min(total, dataEnd + (len & 1));
    yield { fourcc, start: i, end, data: bytes.subarray(i + 8, dataEnd) };
    i = end;
  }
}

export function stripWebp(bytes: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [];
  let sawData = false;
  for (const c of webpChunks(bytes)) {
    if (c.fourcc === "VP8 " || c.fourcc === "VP8L" || c.fourcc === "ANIM") sawData = true;
    if (!WEBP_KEEP.has(c.fourcc)) continue;
    let chunk = bytes.subarray(c.start, c.end);
    if (c.fourcc === "VP8X") {
      if (c.data.length < 10) throw new ImageStripError("short VP8X chunk");
      chunk = chunk.slice();
      chunk[8] &= ~(VP8X_EXIF | VP8X_XMP);
    }
    parts.push(chunk);
  }
  if (!sawData) throw new ImageStripError("webp has no image data");
  const body = concat(parts);
  const out = new Uint8Array(12 + body.length);
  out.set(bytes.subarray(0, 12));
  out.set(body, 12);
  const size = out.length - 8;
  out[4] = size & 0xff;
  out[5] = (size >>> 8) & 0xff;
  out[6] = (size >>> 16) & 0xff;
  out[7] = (size >>> 24) & 0xff;
  return out;
}

// ---------------------------------------------------------------------------
// audits: does an image still carry a location? conservative: a gps ifd
// pointer or any xmp/text gps field counts, even if its values don't parse.

const XMP_GPS_RE = /GPS(Latitude|Longitude)|exif:GPS|drone-dji:(Gps|Latitude)/i;

function tiffHasGps(tiff: Uint8Array): boolean {
  let t = tiff;
  if (ascii(t, 0, 6) === "Exif\0\0") t = t.subarray(6);
  if (t.length < 8) return false;
  const order = ascii(t, 0, 2);
  if (order !== "II" && order !== "MM") return false;
  const le = order === "II";
  const u16 = (o: number) => (le ? t[o] | (t[o + 1] << 8) : (t[o] << 8) | t[o + 1]);
  const u32 = (o: number) =>
    (le ? t[o] | (t[o + 1] << 8) | (t[o + 2] << 16) | (t[o + 3] << 24) : (t[o] << 24) | (t[o + 1] << 16) | (t[o + 2] << 8) | t[o + 3]) >>> 0;
  // walk ifd0 and any following ifds (thumbnails) for the gps pointer
  let ifd = u32(4);
  const seen = new Set<number>();
  while (ifd && ifd + 2 <= t.length && !seen.has(ifd)) {
    seen.add(ifd);
    const n = u16(ifd);
    for (let k = 0; k < n; k++) {
      const e = ifd + 2 + k * 12;
      if (e + 12 > t.length) return false;
      if (u16(e) === 0x8825) return true;
    }
    const nextAt = ifd + 2 + n * 12;
    ifd = nextAt + 4 <= t.length ? u32(nextAt) : 0;
  }
  return false;
}

const latin1 = (b: Uint8Array) => {
  let s = "";
  for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192));
  return s;
};

export function hasLocationMetadata(bytes: Uint8Array): boolean {
  const format = sniffImageFormat(bytes);
  try {
    if (format === "jpeg") {
      for (const seg of jpegSegments(bytes)) {
        if (seg.marker === 0xe1) {
          if (ascii(seg.payload, 0, 6) === "Exif\0\0" && tiffHasGps(seg.payload)) return true;
          if (XMP_GPS_RE.test(latin1(seg.payload))) return true;
        } else if ((seg.marker >= 0xe2 && seg.marker <= 0xef) || seg.marker === 0xfe) {
          if (XMP_GPS_RE.test(latin1(seg.payload))) return true;
        }
      }
      return false;
    }
    if (format === "png") {
      for (const c of pngChunks(bytes)) {
        if (c.type === "eXIf" && tiffHasGps(c.data)) return true;
        if (!PNG_KEEP.has(c.type) && XMP_GPS_RE.test(latin1(c.data))) return true;
      }
      return false;
    }
    if (format === "webp") {
      for (const c of webpChunks(bytes)) {
        if (c.fourcc === "EXIF" && tiffHasGps(c.data)) return true;
        if (c.fourcc === "XMP " && XMP_GPS_RE.test(latin1(c.data))) return true;
      }
      return false;
    }
  } catch {
    // unparseable container: fall through to the raw scan
  }
  // unknown or malformed: look for a tiff gps tag or xmp gps text anywhere
  const s = latin1(bytes);
  if (XMP_GPS_RE.test(s)) return true;
  for (const sig of ["II*\0", "MM\0*"]) {
    for (let at = s.indexOf(sig); at !== -1; at = s.indexOf(sig, at + 1)) {
      if (tiffHasGps(bytes.subarray(at))) return true;
    }
  }
  return false;
}
