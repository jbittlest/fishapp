// @vitest-environment node
/* tools/storeshots/png.mjs — App Store Connect rejects screenshots with an alpha channel, so the
   renderer flattens and re-checks every PNG. Fixtures are built here byte by byte (zlib only). */
import { describe, it, expect } from 'vitest';
import zlib from 'node:zlib';
import { decodePng, encodeRgbPng, flattenPng, pngHasAlpha, pngInfo } from '../../../tools/storeshots/png.mjs';

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
/** A PNG with unfiltered rows (filter byte 0), any colour type / depth, optional extra chunks. */
function makePng(width, height, colorType, pixels, { bitDepth = 8, extra = [] } = {}) {
  const ch = colorType === 6 ? 4 : 3;
  const stride = width * ch * (bitDepth / 8);
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = bitDepth; ihdr[9] = colorType;
  return Buffer.concat([SIG, chunk('IHDR', ihdr), ...extra, chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

describe('pngInfo', () => {
  it('reads size and colour type from the header', () => {
    const png = makePng(3, 2, 6, Buffer.alloc(3 * 2 * 4, 255));
    expect(pngInfo(png)).toMatchObject({ width: 3, height: 2, bitDepth: 8, colorType: 6, hasTrns: false });
    expect(pngHasAlpha(pngInfo(png))).toBe(true);
  });
  it('refuses a file that is not a PNG', () => {
    expect(() => pngInfo(Buffer.from('GIF89a not a png'))).toThrow(/not a PNG/);
  });
});

describe('encodeRgbPng / decodePng', () => {
  it('round-trips pixels through every row filter', () => {
    // gradients, noise and flat runs so the per-row filter choice varies
    const w = 37, h = 23, rgb = Buffer.alloc(w * h * 3);
    let seed = 7;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      seed = (seed * 1103515245 + 12345) >>> 0;
      rgb[i] = y < 8 ? x * 6 : (seed >>> 16) & 0xff;
      rgb[i + 1] = y * 11;
      rgb[i + 2] = y > 15 ? 200 : (x * y) & 0xff;
    }
    const png = encodeRgbPng(w, h, rgb);
    expect(pngInfo(png)).toMatchObject({ width: w, height: h, colorType: 2 });
    const back = decodePng(png);
    expect(back.channels).toBe(3);
    expect(back.data.equals(rgb)).toBe(true);
  });
  it('refuses bit depths Chrome never writes', () => {
    expect(() => decodePng(makePng(1, 1, 2, Buffer.alloc(6), { bitDepth: 16 }))).toThrow(/unsupported/);
  });
});

describe('flattenPng', () => {
  const INK = [6, 11, 17];

  it('returns an opaque RGB PNG untouched', () => {
    const png = encodeRgbPng(2, 2, Buffer.alloc(12, 90));
    expect(flattenPng(png, INK)).toBe(png);
  });

  it('composites RGBA onto the background and drops the alpha channel', () => {
    const px = Buffer.from([
      255, 181, 71, 255,   // opaque amber stays amber
      255, 255, 255, 0,    // fully transparent becomes the background
      200, 100, 0, 128,    // half alpha blends
      0, 0, 0, 255,
    ]);
    const out = flattenPng(makePng(2, 2, 6, px), INK);
    const info = pngInfo(out);
    expect(info).toMatchObject({ width: 2, height: 2, colorType: 2 });
    expect(pngHasAlpha(info)).toBe(false);
    const { data } = decodePng(out);
    expect([...data.subarray(0, 3)]).toEqual([255, 181, 71]);
    expect([...data.subarray(3, 6)]).toEqual(INK);
    expect([...data.subarray(6, 9)]).toEqual([
      Math.round((200 * 128 + 6 * 127) / 255), Math.round((100 * 128 + 11 * 127) / 255), Math.round((0 * 128 + 17 * 127) / 255),
    ]);
    expect([...data.subarray(9, 12)]).toEqual([0, 0, 0]);
  });

  it('strips a tRNS colour key from an RGB PNG', () => {
    const rgb = Buffer.from([1, 2, 3, 4, 5, 6]);
    const png = makePng(2, 1, 2, rgb, { extra: [chunk('tRNS', Buffer.from([0, 1, 0, 2, 0, 3]))] });
    expect(pngHasAlpha(pngInfo(png))).toBe(true);
    const out = flattenPng(png, INK);
    expect(pngHasAlpha(pngInfo(out))).toBe(false);
    expect(decodePng(out).data.equals(rgb)).toBe(true);
  });
});
