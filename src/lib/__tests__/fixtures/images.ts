// hand-built image fixtures for the metadata tests. structurally valid
// containers with real exif/tiff blocks; pixel payloads are tiny placeholders.

const enc = (s: string) => new TextEncoder().encode(s);

export function concatBytes(...parts: (Uint8Array | number[])[]): Uint8Array {
  const arrs = parts.map((p) => (p instanceof Uint8Array ? p : new Uint8Array(p)));
  const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0));
  let off = 0;
  for (const a of arrs) {
    out.set(a, off);
    off += a.length;
  }
  return out;
}

// little-endian tiff with ifd0 → exif ifd (DateTimeOriginal + OffsetTimeOriginal)
// and gps ifd (lat/lng with refs). coordinates as deg/min/sec rationals.
export function buildTiff(opts: {
  lat?: number;
  lng?: number;
  dateTimeOriginal?: string; // "YYYY:MM:DD HH:MM:SS"
  offsetTimeOriginal?: string; // "+HH:MM"
} = {}): Uint8Array {
  const buf: number[] = [];
  const u16 = (v: number) => [v & 0xff, (v >> 8) & 0xff];
  const u32 = (v: number) => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff];
  type Entry = { tag: number; type: number; count: number; value: number[] }; // value: inline (≤4) or out-of-line bytes
  const asciiVal = (s: string) => [...enc(s), 0];
  const rationals = (deg: number) => {
    const a = Math.abs(deg);
    const d = Math.floor(a);
    const m = Math.floor((a - d) * 60);
    const s = Math.round(((a - d) * 60 - m) * 60 * 10000);
    return [...u32(d), ...u32(1), ...u32(m), ...u32(1), ...u32(s), ...u32(10000)];
  };

  const exifEntries: Entry[] = [];
  if (opts.dateTimeOriginal) exifEntries.push({ tag: 0x9003, type: 2, count: 20, value: asciiVal(opts.dateTimeOriginal) });
  if (opts.offsetTimeOriginal) exifEntries.push({ tag: 0x9011, type: 2, count: 7, value: asciiVal(opts.offsetTimeOriginal) });
  const gpsEntries: Entry[] = [];
  if (opts.lat !== undefined && opts.lng !== undefined) {
    gpsEntries.push({ tag: 0x0001, type: 2, count: 2, value: asciiVal(opts.lat >= 0 ? "N" : "S") });
    gpsEntries.push({ tag: 0x0002, type: 5, count: 3, value: rationals(opts.lat) });
    gpsEntries.push({ tag: 0x0003, type: 2, count: 2, value: asciiVal(opts.lng >= 0 ? "E" : "W") });
    gpsEntries.push({ tag: 0x0004, type: 5, count: 3, value: rationals(opts.lng) });
  }

  // layout: header(8) | ifd0 | exif ifd | gps ifd | data area
  const ifdSize = (n: number) => 2 + n * 12 + 4;
  const ifd0Entries: Entry[] = [];
  if (exifEntries.length) ifd0Entries.push({ tag: 0x8769, type: 4, count: 1, value: [] });
  if (gpsEntries.length) ifd0Entries.push({ tag: 0x8825, type: 4, count: 1, value: [] });
  const ifd0At = 8;
  const exifAt = ifd0At + ifdSize(ifd0Entries.length);
  const gpsAt = exifAt + (exifEntries.length ? ifdSize(exifEntries.length) : 0);
  let dataAt = gpsAt + (gpsEntries.length ? ifdSize(gpsEntries.length) : 0);
  const data: number[] = [];
  for (const e of ifd0Entries) e.value = u32(e.tag === 0x8769 ? exifAt : gpsAt);

  const writeIfd = (entries: Entry[]) => {
    buf.push(...u16(entries.length));
    for (const e of entries) {
      buf.push(...u16(e.tag), ...u16(e.type), ...u32(e.count));
      if (e.value.length <= 4) {
        buf.push(...e.value, ...new Array(4 - e.value.length).fill(0));
      } else {
        buf.push(...u32(dataAt + data.length));
        data.push(...e.value);
        if (e.value.length & 1) data.push(0);
      }
    }
    buf.push(...u32(0));
  };

  buf.push(0x49, 0x49, 0x2a, 0x00, ...u32(ifd0At));
  writeIfd(ifd0Entries);
  if (exifEntries.length) writeIfd(exifEntries);
  if (gpsEntries.length) writeIfd(gpsEntries);
  dataAt = buf.length; // sanity: layout math must line up
  if (dataAt !== gpsAt + (gpsEntries.length ? ifdSize(gpsEntries.length) : 0)) throw new Error("tiff layout");
  return new Uint8Array([...buf, ...data]);
}

const seg = (marker: number, payload: Uint8Array | number[]) => {
  const p = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
  return concatBytes([0xff, marker, ((p.length + 2) >> 8) & 0xff, (p.length + 2) & 0xff], p);
};

export const JPEG_PARTS = {
  soi: new Uint8Array([0xff, 0xd8]),
  app0: seg(0xe0, [...enc("JFIF"), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]),
  icc: seg(0xe2, concatBytes(enc("ICC_PROFILE"), [0, 1, 1], [0, 0, 0, 16, 1, 2, 3, 4])),
  mpf: seg(0xe2, concatBytes(enc("MPF"), [0], [1, 2, 3, 4])),
  xmp: seg(0xe1, concatBytes(enc("http://ns.adobe.com/xap/1.0/\0"), enc('<x:xmpmeta><rdf:Description exif:GPSLatitude="37,52.2N"/></x:xmpmeta>'))),
  iptc: seg(0xed, concatBytes(enc("Photoshop 3.0\0"), [8, 0, 1, 2])),
  app5: seg(0xe5, [1, 2, 3]),
  adobe: seg(0xee, concatBytes(enc("Adobe"), [0, 100, 0, 0, 0, 0, 1])),
  com: seg(0xfe, enc("shot on a phone at home")),
  dqt: seg(0xdb, [0, ...new Array(64).fill(1)]),
  sof: seg(0xc0, [8, 0, 8, 0, 8, 1, 1, 0x11, 0]),
  dht: seg(0xc4, [0x00, 0, 1, ...new Array(14).fill(0), 0]),
  sos: seg(0xda, [1, 1, 0x00, 0, 63, 0]),
  // entropy data with a stuffed 0xff00 and a restart marker inside the scan
  scan: new Uint8Array([0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56, 0x78]),
  eoi: new Uint8Array([0xff, 0xd9]),
};

export function exifApp1(tiff: Uint8Array): Uint8Array {
  return seg(0xe1, concatBytes(enc("Exif\0\0"), tiff));
}

export function buildJpeg(tiff: Uint8Array): Uint8Array {
  const p = JPEG_PARTS;
  return concatBytes(
    p.soi, p.app0, exifApp1(tiff), p.xmp, p.icc, p.mpf, p.iptc, p.app5, p.adobe, p.com,
    p.dqt, p.sof, p.dht, p.sos, p.scan, p.eoi,
    enc("trailing secondary image with Exif") // after EOI
  );
}

// the bytes a clean strip must produce
export function strippedJpeg(): Uint8Array {
  const p = JPEG_PARTS;
  return concatBytes(p.soi, p.app0, p.icc, p.adobe, p.dqt, p.sof, p.dht, p.sos, p.scan, p.eoi);
}

// ---------------------------------------------------------------------------
// webp

const le32 = (v: number) => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff];

export function riffChunk(fourcc: string, data: Uint8Array | number[]): Uint8Array {
  const d = data instanceof Uint8Array ? data : new Uint8Array(data);
  return concatBytes(enc(fourcc), le32(d.length), d, d.length & 1 ? [0] : []);
}

export function webpFile(chunks: Uint8Array[]): Uint8Array {
  const body = concatBytes(enc("WEBP"), ...chunks);
  return concatBytes(enc("RIFF"), le32(body.length), body);
}

export const WEBP_PARTS = {
  // flags: icc(0x20) | exif(0x08) | xmp(0x04); canvas 1x1
  vp8x: (flags: number) => riffChunk("VP8X", [flags, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
  iccp: riffChunk("ICCP", [1, 2, 3, 4]),
  vp8l: riffChunk("VP8L", [0x2f, 0, 0, 0, 0x10, 0x07, 0x10, 0x11, 0x11, 0x88, 0x88, 0xfe, 0x07]), // odd length → pad
  xmp: riffChunk("XMP ", enc('<x:xmpmeta exif:GPSLongitude="122,15.6W"/>')),
};

export function buildWebp(tiff: Uint8Array): Uint8Array {
  const p = WEBP_PARTS;
  return webpFile([p.vp8x(0x20 | 0x08 | 0x04), p.iccp, p.vp8l, riffChunk("EXIF", tiff), p.xmp]);
}

// ---------------------------------------------------------------------------
// png (crc values are not checked by the stripper; real crc anyway)

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function pngChunk(type: string, data: Uint8Array | number[]): Uint8Array {
  const d = data instanceof Uint8Array ? data : new Uint8Array(data);
  const td = concatBytes(enc(type), d);
  const crc = crc32(td);
  const be = (v: number) => [(v >>> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
  return concatBytes(be(d.length), td, be(crc));
}

export const PNG_PARTS = {
  sig: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  ihdr: pngChunk("IHDR", [0, 0, 0, 1, 0, 0, 0, 1, 8, 0, 0, 0, 0]),
  idat: pngChunk("IDAT", [0x78, 0x9c, 0x63, 0x60, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01]),
  text: pngChunk("tEXt", concatBytes(enc("Comment"), [0], enc("home"))),
  itxt: pngChunk("iTXt", concatBytes(enc("XML:com.adobe.xmp"), [0, 0, 0, 0, 0], enc('<x exif:GPSLatitude="1"/>'))),
  ztxt: pngChunk("zTXt", concatBytes(enc("Author"), [0, 0], [0x78, 0x9c])),
  iend: pngChunk("IEND", []),
};

export function buildPng(tiff: Uint8Array): Uint8Array {
  const p = PNG_PARTS;
  return concatBytes(p.sig, p.ihdr, pngChunk("eXIf", tiff), p.text, p.itxt, p.ztxt, p.idat, p.iend);
}
