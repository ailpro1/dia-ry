/* Generates the app icons as PNGs with no image library, so they can be
   rebuilt anywhere Node runs. Run: node scripts/make-icons.mjs */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const OUT = new URL('../icons/', import.meta.url);
mkdirSync(OUT, { recursive: true });

const CREAM = [251, 232, 211];
const INK = [46, 43, 40];
const LAV = [174, 179, 224];

/** Draw at 4x and box-filter down, which is enough antialiasing for an icon. */
function render(size, { maskable = false } = {}) {
  const SS = 4;
  const n = size * SS;
  const buf = new Float32Array(n * n * 3);

  const put = (x, y, rgb) => {
    const i = (y * n + x) * 3;
    buf[i] = rgb[0]; buf[i + 1] = rgb[1]; buf[i + 2] = rgb[2];
  };

  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) put(x, y, CREAM);
  }

  // Safe area: maskable icons get a 20% margin so nothing is cropped away.
  const pad = maskable ? n * 0.28 : n * 0.2;
  const inner = n - pad * 2;

  const bar = (row, widthFrac, rgb) => {
    const h = inner * 0.13;
    const gap = inner * 0.135;
    const top = pad + inner * 0.22 + row * (h + gap);
    const left = pad;
    const right = pad + inner * widthFrac;
    const r = h / 2;
    for (let y = Math.floor(top); y < top + h; y += 1) {
      for (let x = Math.floor(left); x < right; x += 1) {
        const dxL = left + r - x;
        const dxR = x - (right - r);
        const dy = y - (top + r);
        const dx = Math.max(dxL, dxR, 0);
        if (dx * dx + dy * dy <= r * r) put(x, y, rgb);
      }
    }
  };

  bar(0, 1.0, INK);
  bar(1, 0.62, INK);
  bar(2, 0.82, LAV);

  // Downsample
  const out = Buffer.alloc(size * size * 3);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0; let g = 0; let b = 0;
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const i = (((y * SS + sy) * n) + (x * SS + sx)) * 3;
          r += buf[i]; g += buf[i + 1]; b += buf[i + 2];
        }
      }
      const c = SS * SS;
      const o = (y * size + x) * 3;
      out[o] = Math.round(r / c);
      out[o + 1] = Math.round(g / c);
      out[o + 2] = Math.round(b / c);
    }
  }
  return out;
}

function png(rgb, size) {
  const stride = size * 3;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 2;   // colour type: truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return ~c;
}

const jobs = [
  ['icon-180.png', 180, {}],
  ['icon-192.png', 192, {}],
  ['icon-512.png', 512, {}],
  ['icon-maskable-512.png', 512, { maskable: true }],
  ['favicon.png', 64, {}],
];

for (const [name, size, opts] of jobs) {
  writeFileSync(new URL(name, OUT), png(render(size, opts), size));
  console.log('wrote icons/%s', name);
}
