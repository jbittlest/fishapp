/* Just enough PNG to satisfy App Store Connect: read the header, and flatten any alpha onto a solid
 * colour (screenshots with an alpha channel are rejected). 8-bit RGB / RGBA only — that is all
 * Chrome writes — anything else throws rather than guessing. node:zlib only, no packages. */
import zlib from 'node:zlib';

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CHANNELS = { 2: 3, 6: 4 };

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Split a PNG into its chunks ({type, data}), checking the signature. */
export function pngChunks(buf) {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(SIG)) throw new Error('not a PNG');
  const out = [];
  let p = 8;
  while (p + 8 <= buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('latin1', p + 4, p + 8);
    out.push({ type, data: buf.subarray(p + 8, p + 8 + len) });
    p += 12 + len;
    if (type === 'IEND') break;
  }
  return out;
}

function infoOf(chunks) {
  const ihdr = chunks[0];
  if (!ihdr || ihdr.type !== 'IHDR') throw new Error('PNG without IHDR');
  return {
    width: ihdr.data.readUInt32BE(0),
    height: ihdr.data.readUInt32BE(4),
    bitDepth: ihdr.data[8],
    colorType: ihdr.data[9],
    interlaced: ihdr.data[12] !== 0,
    hasTrns: chunks.some((c) => c.type === 'tRNS'),
  };
}

/** Width, height, bit depth, colour type (2 = RGB, 6 = RGBA) and whether a tRNS chunk adds transparency. */
export function pngInfo(buf) {
  return infoOf(pngChunks(buf));
}

/** True when App Store Connect would see an alpha channel. */
export function pngHasAlpha(info) {
  return info.colorType === 4 || info.colorType === 6 || info.hasTrns;
}

function paeth(a, b, c) {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Decode an 8-bit, non-interlaced RGB or RGBA PNG to raw pixels. */
export function decodePng(buf) {
  const chunks = pngChunks(buf);
  const info = infoOf(chunks);
  const ch = CHANNELS[info.colorType];
  if (info.bitDepth !== 8 || !ch) throw new Error(`unsupported PNG (bit depth ${info.bitDepth}, colour type ${info.colorType})`);
  if (info.interlaced) throw new Error('interlaced PNG not supported');
  const raw = zlib.inflateSync(Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data)));
  const stride = info.width * ch;
  const data = Buffer.alloc(stride * info.height);
  for (let y = 0; y < info.height; y++) {
    const f = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1, dst = y * stride, up = dst - stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? data[dst + x - ch] : 0;
      const b = y > 0 ? data[up + x] : 0;
      const c = x >= ch && y > 0 ? data[up + x - ch] : 0;
      const v = raw[src + x];
      data[dst + x] = (f === 0 ? v : f === 1 ? v + a : f === 2 ? v + b : f === 3 ? v + ((a + b) >> 1) : v + paeth(a, b, c)) & 0xff;
    }
  }
  return { width: info.width, height: info.height, channels: ch, data };
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/** Encode 8-bit RGB pixels (width × height × 3) as a PNG, picking each row's filter by the usual
 *  minimum-sum-of-absolute-differences heuristic so the file stays close to Chrome's size. */
export function encodeRgbPng(width, height, rgb) {
  const stride = width * 3;
  const out = Buffer.alloc((stride + 1) * height);
  const cand = Array.from({ length: 5 }, () => Buffer.alloc(stride));
  for (let y = 0; y < height; y++) {
    const row = y * stride, up = row - stride;
    let best = 0, bestSum = Infinity;
    for (let f = 0; f < 5; f++) {
      const c = cand[f];
      let sum = 0;
      for (let x = 0; x < stride; x++) {
        const a = x >= 3 ? rgb[row + x - 3] : 0;
        const b = y > 0 ? rgb[up + x] : 0;
        const d = x >= 3 && y > 0 ? rgb[up + x - 3] : 0;
        const v = rgb[row + x];
        const r = (f === 0 ? v : f === 1 ? v - a : f === 2 ? v - b : f === 3 ? v - ((a + b) >> 1) : v - paeth(a, b, d)) & 0xff;
        c[x] = r;
        sum += r < 128 ? r : 256 - r;
      }
      if (sum < bestSum) { bestSum = sum; best = f; }
    }
    out[y * (stride + 1)] = best;
    cand[best].copy(out, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([SIG, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(out, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/** The same image with no alpha: unchanged if it is already opaque RGB, otherwise every pixel is
 *  composited over `bg` ([r, g, b]) and re-encoded as RGB. */
export function flattenPng(buf, bg = [0, 0, 0]) {
  const info = pngInfo(buf);
  if (!pngHasAlpha(info)) return buf;
  if (info.colorType === 2) {
    // RGB with a tRNS colour key: the pixels are fine, only the chunk marks some transparent.
    return Buffer.concat([SIG, ...pngChunks(buf).filter((c) => c.type !== 'tRNS').map((c) => chunk(c.type, c.data))]);
  }
  const img = decodePng(buf);
  const rgb = Buffer.alloc(img.width * img.height * 3);
  for (let i = 0, j = 0; i < img.data.length; i += 4, j += 3) {
    const a = img.data[i + 3];
    for (let k = 0; k < 3; k++) rgb[j + k] = Math.round((img.data[i + k] * a + bg[k] * (255 - a)) / 255);
  }
  return encodeRgbPng(img.width, img.height, rgb);
}
