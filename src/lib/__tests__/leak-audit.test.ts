import { describe, it, expect } from "vitest";
import { encodeMultiPolyline, encodePolyline } from "../polyline";
import { ZONE_EDGE_BUFFER_M, publicZoneShape } from "../privacy/fog";
import {
  checkBounds,
  checkFogShapes,
  checkPhotoMetadata,
  checkPolyline,
  checkPublicActivity,
  checkPublicOriginals,
  checkVisibility,
  findPrivateKeys,
  imageFormat,
  photoMetadata,
  summarize,
  webpChunks,
} from "../privacy/leak-audit";

// a ~1.1 km square zone around (37.875, -122.255); rings are [lng, lat]
const zone = {
  id: 5,
  polygon: [[[-122.26, 37.87], [-122.25, 37.87], [-122.25, 37.88], [-122.26, 37.88], [-122.26, 37.87]]],
};
const zones = [zone];
// ~0.0001° lat ≈ 11 m
const inside: [number, number] = [37.875, -122.255];
const nearOutside: [number, number] = [37.8801, -122.255]; // ~11 m north of the edge
const farOutside: [number, number] = [37.9, -122.255];

describe("findPrivateKeys", () => {
  it("finds private keys at any depth", () => {
    expect(findPrivateKeys({ a: 1, photos: [{ url: "u", gpsLat: 1 }], x: { trackBbox: {} } })).toEqual([
      "photos[0].gpsLat",
      "x.trackBbox",
    ]);
    expect(findPrivateKeys({ id: 1, name: "run", polyline: "abc" })).toEqual([]);
  });
});

describe("points against zones", () => {
  it("strictly inside is a leak, within the buffer a warning, far away nothing", () => {
    const pl = encodePolyline([farOutside, inside, nearOutside]);
    const f = checkPolyline(pl, zones, "a");
    expect(summarize(f)).toEqual({ leaks: 1, warnings: 1 });
    expect(f[0].message).toMatch(/1 point\(s\) inside zone\(s\) 5/);
    expect(f[1].message).toMatch(new RegExp(`within ${ZONE_EDGE_BUFFER_M} m`));
    expect(checkPolyline(encodePolyline([farOutside, [37.91, -122.255]]), zones, "a")).toEqual([]);
  });

  it("checks every segment of a multi-segment polyline", () => {
    const pl = encodeMultiPolyline([[farOutside, [37.91, -122.255]], [[37.92, -122.255], inside]]);
    expect(summarize(checkPolyline(pl, zones, "a")).leaks).toBe(1);
  });

  it("no zones, no findings; null polylines are fine", () => {
    expect(checkPolyline(encodePolyline([inside, inside]), [], "a")).toEqual([]);
    expect(checkPolyline(null, zones, "a")).toEqual([]);
  });

  it("bounds corners", () => {
    const b = { minLat: 37.874, minLng: -122.256, maxLat: 37.9, maxLng: -122.2 };
    expect(summarize(checkBounds(b, zones, "a")).leaks).toBe(1);
    expect(checkBounds({ minLat: 37.9, minLng: -122.3, maxLat: 37.95, maxLng: -122.2 }, zones, "a")).toEqual([]);
    expect(checkBounds({ minLat: "x" }, zones, "a")[0].severity).toBe("warning");
  });
});

describe("checkFogShapes", () => {
  it("accepts the published shape (outer ring, rounded)", () => {
    expect(checkFogShapes([publicZoneShape(zone.polygon)], "a")).toEqual([]);
    expect(checkFogShapes(null, "a")).toEqual([]);
  });

  it("flags inner rings and unrounded vertices", () => {
    const holed = [[...zone.polygon, [[-122.256, 37.874], [-122.254, 37.874], [-122.254, 37.876]]]];
    expect(checkFogShapes(holed, "a").some((f) => /2 rings/.test(f.message))).toBe(true);
    const precise = [[[[-122.2512345, 37.87], [-122.25, 37.88], [-122.26, 37.88]]]];
    const f = checkFogShapes(precise, "a");
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ severity: "leak" });
    expect(f[0].message).toMatch(/finer than 4 decimals/);
  });
});

describe("checkPublicActivity", () => {
  it("checks route, card route, bounds, fog edges, pins and keys together", () => {
    const f = checkPublicActivity(
      {
        id: 1,
        polyline: encodePolyline([farOutside, [37.91, -122.255]]),
        cardPolyline: encodePolyline([farOutside, inside]),
        bounds: null,
        fogEvents: [{ entry: nearOutside, exit: null, durationS: 60 }],
        fogShapes: [publicZoneShape(zone.polygon)],
        photos: [{ url: "u", pin: inside }, { url: "v", pin: null }],
        source: "strava-api",
      } as Record<string, unknown>,
      zones,
      "activity 1"
    );
    const wheres = f.map((x) => `${x.severity} ${x.where}`);
    expect(wheres).toContain("leak activity 1"); // the private key
    expect(wheres).toContain("leak activity 1 cardPolyline");
    expect(wheres).toContain("warning activity 1 fogEvents");
    expect(wheres).toContain("leak activity 1 photo pins");
    expect(wheres.some((w) => w.endsWith(" polyline"))).toBe(false);
  });
});

describe("checkVisibility", () => {
  it("hide map: any route/fog/pin served is a leak", () => {
    const f = checkVisibility({ polyline: "x", bounds: null, photos: [{ pin: [1, 2] }] }, { mapHidden: true, hrHidden: false }, "a");
    expect(f.map((x) => x.message)).toEqual(['map hidden but "polyline" is served', "map hidden but photo pins are served"]);
  });

  it("hide hr: hr and effort served are leaks", () => {
    const f = checkVisibility({ averageHeartrate: 150, maxHeartrate: null, sufferScore: 30 }, { mapHidden: false, hrHidden: true }, "a");
    expect(f).toHaveLength(2);
    expect(checkVisibility({ averageHeartrate: 150 }, { mapHidden: false, hrHidden: false }, "a")).toEqual([]);
  });
});

// minimal little-endian tiff: ifd0 → gps ifd with N 37°52' / W 122°15'
function gpsTiff(): Uint8Array {
  const b = new Uint8Array(128);
  const v = new DataView(b.buffer);
  b.set([0x49, 0x49, 0x2a, 0x00]);
  v.setUint32(4, 8, true);
  v.setUint16(8, 1, true);
  v.setUint16(10, 0x8825, true); // GPSInfo pointer
  v.setUint16(12, 4, true);
  v.setUint32(14, 1, true);
  v.setUint32(18, 26, true);
  v.setUint32(22, 0, true);
  v.setUint16(26, 4, true);
  const entry = (o: number, tag: number, type: number, count: number, value: number | string) => {
    v.setUint16(o, tag, true);
    v.setUint16(o + 2, type, true);
    v.setUint32(o + 4, count, true);
    if (typeof value === "string") b.set([...new TextEncoder().encode(value), 0], o + 8);
    else v.setUint32(o + 8, value, true);
  };
  entry(28, 0x0001, 2, 2, "N");
  entry(40, 0x0002, 5, 3, 80);
  entry(52, 0x0003, 2, 2, "W");
  entry(64, 0x0004, 5, 3, 104);
  v.setUint32(76, 0, true);
  [37, 1, 52, 1, 0, 1].forEach((n, i) => v.setUint32(80 + i * 4, n, true));
  [122, 1, 15, 1, 0, 1].forEach((n, i) => v.setUint32(104 + i * 4, n, true));
  return b;
}

function jpegWith(tiff: Uint8Array | null): Uint8Array {
  const parts: number[] = [0xff, 0xd8];
  if (tiff) {
    const len = 2 + 6 + tiff.length;
    parts.push(0xff, 0xe1, len >> 8, len & 0xff, ...new TextEncoder().encode("Exif"), 0, 0, ...tiff);
  }
  parts.push(0xff, 0xd9);
  return new Uint8Array(parts);
}

function webpWith(chunks: [string, Uint8Array][]): Uint8Array {
  const body: number[] = [...new TextEncoder().encode("WEBP")];
  for (const [fourcc, data] of chunks) {
    const n = data.length;
    body.push(...new TextEncoder().encode(fourcc), n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff, ...data);
    if (n % 2) body.push(0);
  }
  const n = body.length;
  return new Uint8Array([...new TextEncoder().encode("RIFF"), n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff, ...body]);
}

describe("photo metadata", () => {
  it("classifies parsed tags", () => {
    expect(checkPhotoMetadata(null, "p")).toEqual([]);
    expect(checkPhotoMetadata({ latitude: 1, longitude: 2 }, "p")[0].severity).toBe("leak");
    expect(checkPhotoMetadata({ GPSAltitude: 4 }, "p")[0].severity).toBe("leak");
    const w = checkPhotoMetadata({ Make: "x", DateTimeOriginal: "2026" }, "p");
    expect(w[0].severity).toBe("warning");
    expect(w[0].message).toMatch(/DateTimeOriginal/);
  });

  it("finds gps in a jpeg and nothing in a stripped one", async () => {
    expect(imageFormat(jpegWith(null))).toBe("jpeg");
    const meta = await photoMetadata(jpegWith(gpsTiff()));
    expect(summarize(checkPhotoMetadata(meta, "p")).leaks).toBe(1);
    expect(await photoMetadata(jpegWith(null))).toBeNull();
  });

  it("reads webp EXIF / XMP chunks", async () => {
    const webp = webpWith([["VP8 ", new Uint8Array(10)], ["EXIF", gpsTiff()]]);
    expect(imageFormat(webp)).toBe("webp");
    expect(webpChunks(webp).map((c) => c.fourcc)).toEqual(["VP8 ", "EXIF"]);
    expect(summarize(checkPhotoMetadata(await photoMetadata(webp), "p")).leaks).toBe(1);
    const xmp = webpWith([["XMP ", new TextEncoder().encode("<x exif:GPSLatitude='1'/>")]]);
    expect(summarize(checkPhotoMetadata(await photoMetadata(xmp), "p")).leaks).toBe(1);
    expect(await photoMetadata(webpWith([["VP8 ", new Uint8Array(3)]]))).toBeNull();
  });
});

describe("checkPublicOriginals", () => {
  it("warns (never a leak) with a count", () => {
    expect(checkPublicOriginals([], "b")).toEqual([]);
    const f = checkPublicOriginals([{ key: "activities/fit/2026/a.fit", size: 2e6 }], "b");
    expect(f).toEqual([expect.objectContaining({ severity: "warning" })]);
    expect(f[0].message).toMatch(/^1 original file\(s\) \(2\.0 MB\)/);
  });
});
